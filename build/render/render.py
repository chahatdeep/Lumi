# Photoreal Cycles render of a Lumi lithophane STL on a desk, lamp off and backlit.
# Usage: blender -b -P build/render/render.py -- <in.stl> <out_prefix> [samples]
# Writes <out_prefix>-off.png (room light only) and <out_prefix>-on.png (warm LED behind the print).
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
stl, prefix = argv[0], argv[1]
samples = int(argv[2]) if len(argv) > 2 else 256

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.scale_length = 1.0

# ---------------------------------------------------------------- lithophane
bpy.ops.wm.stl_import(filepath=stl)
litho = bpy.context.selected_objects[0]
litho.scale = (0.001, 0.001, 0.001)  # Lumi exports millimetres
bpy.context.view_layer.update()
bb = [litho.matrix_world @ Vector(c) for c in litho.bound_box]
mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
litho.location -= Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
bpy.context.view_layer.update()
W, D, H = mx.x - mn.x, mx.y - mn.y, mx.z - mn.z
bpy.ops.object.shade_flat()

# white PLA: dense subsurface scattering so thin areas glow and thick areas block light
pla = bpy.data.materials.new('WhitePLA')
pla.use_nodes = True
b = pla.node_tree.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (0.92, 0.91, 0.88, 1)
b.inputs['Roughness'].default_value = 0.42
b.inputs['Subsurface Weight'].default_value = 1.0
b.inputs['Subsurface Radius'].default_value = (1.0, 0.93, 0.86)
b.inputs['Subsurface Scale'].default_value = float(__import__('os').environ.get('SSS', '0.00009'))
pla.node_tree.nodes['Principled BSDF'].subsurface_method = 'RANDOM_WALK'
b.inputs['Subsurface Anisotropy'].default_value = float(__import__('os').environ.get('ANISO', '0.0'))
litho.data.materials.append(pla)

# ---------------------------------------------------------------- desk + wall
def plane(name, size, loc, rot, mat):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.data.materials.append(mat); return o

wood = bpy.data.materials.new('Wood'); wood.use_nodes = True
nt = wood.node_tree; wb = nt.nodes['Principled BSDF']
tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping')
mp.inputs['Scale'].default_value = (40, 2.2, 40)
wave = nt.nodes.new('ShaderNodeTexWave'); wave.inputs['Scale'].default_value = 3.0
wave.inputs['Distortion'].default_value = 6.0; wave.inputs['Detail'].default_value = 3
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.10, 0.055, 0.03, 1); ramp.color_ramp.elements[1].color = (0.24, 0.14, 0.075, 1)
nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], wave.inputs['Vector'])
nt.links.new(wave.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], wb.inputs['Base Color'])
wb.inputs['Roughness'].default_value = 0.35
plane('Desk', 1.6, (0, 0.15, 0), (0, 0, 0), wood)

wallm = bpy.data.materials.new('Wall'); wallm.use_nodes = True
wallm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.30, 0.29, 1)
wallm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
plane('Wall', 2.0, (0, 0.32, 0.5), (math.radians(90), 0, 0), wallm)

# ---------------------------------------------------------------- camera
cam_data = bpy.data.cameras.new('Cam'); cam_data.lens = 85
cam_data.dof.use_dof = True; cam_data.dof.aperture_fstop = 8
cam = bpy.data.objects.new('Cam', cam_data); sc.collection.objects.link(cam); sc.camera = cam
target = Vector((0, 0, H * 0.52))
cam.location = target + Vector((-0.10, -0.43, 0.05))
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_data.dof.focus_distance = (target - cam.location).length

# ---------------------------------------------------------------- lights
def area(name, size, loc, aim, energy, color, shape='RECTANGLE', sy=None):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.color = color
    l.shape = shape; l.size = size; l.size_y = sy or size
    o = bpy.data.objects.new(name, l); sc.collection.objects.link(o)
    o.location = loc; o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o

def warm(k):  # rough blackbody colour for an LED of k kelvin
    return {2700: (1.0, 0.66, 0.36), 4000: (1.0, 0.82, 0.66), 5600: (1.0, 0.95, 0.9)}[k]

world = bpy.data.worlds.new('World'); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']

# backlight: a warm LED panel just behind the print, plus the glow it throws on the wall/desk
led = area('LED', W * 0.95, (0, mx.y + 0.03, H * 0.55), (0, -1, H * 0.55), float(__import__('os').environ.get('LED', '5.0')), warm(2700), sy=H * 0.9)
# room light from a window at front-left
window = area('Window', 0.9, (-0.9, -0.9, 0.9), (0, 0, H * 0.5), 320, warm(5600))
fill = area('Fill', 0.6, (0.7, -0.6, 0.4), (0, 0, H * 0.5), 40, warm(4000))

# ---------------------------------------------------------------- render settings
sc.render.engine = 'CYCLES'
cy = sc.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
for backend in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = backend; prefs.get_devices()
        if any(d.type == backend for d in prefs.devices):
            for d in prefs.devices: d.use = d.type == backend
            cy.device = 'GPU'; break
    except Exception:
        pass
cy.samples = samples
cy.use_denoising = True
cy.denoiser = 'OPENIMAGEDENOISE'
cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
cy.denoising_prefilter = 'ACCURATE'
cy.max_bounces = 16; cy.transmission_bounces = 16
sc.render.resolution_x, sc.render.resolution_y = 1600, 1200
sc.render.resolution_percentage = int(__import__('os').environ.get('RES', '100'))  # 200 = supersample, downscale afterwards
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'
sc.render.image_settings.file_format = 'PNG'

def shoot(path, led_on, window_e, fill_e, world_strength):
    led.hide_render = not led_on
    window.data.energy = window_e; fill.data.energy = fill_e
    bg.inputs['Color'].default_value = (0.02, 0.022, 0.03, 1); bg.inputs['Strength'].default_value = world_strength
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('rendered', path)

shoot(prefix + '-off.png', False, 45, 6, 0.4)   # daytime: lamp off, the bare white relief
shoot(prefix + '-on.png', True, 0.6, 0.15, 0.05)     # evening: room dark, lamp on behind the print
