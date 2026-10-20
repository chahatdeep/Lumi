# Photoreal Cycles render of a Lumi Pop 3D print (STL in mm, Z up) on a desk in daylight.
# Usage: blender -b -P build/render/render-bust.py -- <in.stl> <out_prefix> [samples]
# Writes <out_prefix>-34.png (three-quarter view) and <out_prefix>-side.png.
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
stl, prefix = argv[0], argv[1]
samples = int(argv[2]) if len(argv) > 2 else 256

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

bpy.ops.wm.stl_import(filepath=stl)
obj = bpy.context.selected_objects[0]
obj.scale = (0.001,) * 3
bpy.context.view_layer.update()
bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
mn = Vector([min(v[i] for v in bb) for i in range(3)]); mx = Vector([max(v[i] for v in bb) for i in range(3)])
obj.location -= Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
bpy.context.view_layer.update()
H = mx.z - mn.z
bpy.ops.object.shade_smooth()

# matte PLA with 0.12 mm layer lines (object space is millimetres)
pla = bpy.data.materials.new('PLA'); pla.use_nodes = True
nt = pla.node_tree; b = nt.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (0.80, 0.77, 0.72, 1)
b.inputs['Roughness'].default_value = 0.48
b.inputs['Subsurface Weight'].default_value = 0.15
b.inputs['Subsurface Radius'].default_value = (1.0, 0.9, 0.8)
b.inputs['Subsurface Scale'].default_value = 0.0004
tc = nt.nodes.new('ShaderNodeTexCoord')
wave = nt.nodes.new('ShaderNodeTexWave'); wave.bands_direction = 'Z'
wave.inputs['Scale'].default_value = 1 / 0.12; wave.inputs['Distortion'].default_value = 0.0
bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.12; bump.inputs['Distance'].default_value = 0.00004
nt.links.new(tc.outputs['Object'], wave.inputs['Vector']); nt.links.new(wave.outputs['Fac'], bump.inputs['Height'])
nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
obj.data.materials.append(pla)

# seamless studio sweep (product-shot look); BG=dark gives a charcoal sweep for dark mode
import os
dark = os.environ.get('BG') == 'dark'
tone = 0.035 if dark else 0.5
sweep = bpy.data.materials.new('Sweep'); sweep.use_nodes = True
sb = sweep.node_tree.nodes['Principled BSDF']
sb.inputs['Base Color'].default_value = (tone, tone, tone * 1.02, 1); sb.inputs['Roughness'].default_value = 0.85
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
sw = bpy.context.object; sw.data.materials.append(sweep)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.subdivide(number_cuts=60); bpy.ops.object.mode_set(mode='OBJECT')
R, back = 0.35, 0.45  # floor runs back, then curves up into a wall
for v in sw.data.vertices:
    x, y = v.co.x * 8.0, (v.co.y + 0.5) * 2.0 - 1.0  # x: -1.5..1.5, y: -1..1 (0 = curve start)
    if y < 0: v.co = Vector((x, back + y * 1.5, 0))
    else:
        t = y * (math.pi / 2 + 1.5)
        if t < math.pi / 2: v.co = Vector((x, back + R * math.sin(t), R - R * math.cos(t)))
        else: v.co = Vector((x, back + R, R + (t - math.pi / 2)))
bpy.ops.object.shade_smooth()

def area(size, loc, aim, energy, color):
    l = bpy.data.lights.new('L', 'AREA'); l.energy = energy; l.color = color; l.size = size
    o = bpy.data.objects.new('L', l); sc.collection.objects.link(o)
    o.location = loc; o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
k = 0.35 if dark else 0.42
area(0.5, (-0.5, -0.05, 0.3), (0, 0, H * 0.55), 40 * k, (1.0, 0.97, 0.94))   # soft key, camera left
area(0.8, (0.6, -0.4, 0.2), (0, 0, H * 0.5), (6 if dark else 1.2) * k, (0.92, 0.95, 1.0))      # fill, camera right
area(0.3, (0.18, 0.3, 0.32), (0, 0, H * 0.75), 18 * k, (1.0, 0.95, 0.9))    # rim/hair light from behind
area(1.2, (0, 0.2, 0.9), (0, 0.2, 0), (18 if dark else 6) * k, (1, 1, 1))                    # top light on the sweep
world = bpy.data.worlds.new('W'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (tone, tone, tone, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.15

cd = bpy.data.cameras.new('Cam'); cd.lens = 85; cd.dof.use_dof = True; cd.dof.aperture_fstop = 5.6
cam = bpy.data.objects.new('Cam', cd); sc.collection.objects.link(cam); sc.camera = cam

sc.render.engine = 'CYCLES'; cy = sc.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
for backend in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = backend; prefs.get_devices()
        if any(d.type == backend for d in prefs.devices):
            for d in prefs.devices: d.use = d.type == backend
            cy.device = 'GPU'; break
    except Exception:
        pass
cy.samples = samples; cy.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 1600, 1200
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
sc.render.resolution_percentage = int(os.environ.get('RES', '100'))
cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'; cy.denoising_prefilter = 'ACCURATE'

def shoot(name, az_deg, elev):
    target = Vector((0, 0, H * 0.5))
    a = math.radians(az_deg); dist = H * 4.4
    cam.location = target + Vector((math.sin(a) * dist, -math.cos(a) * dist, elev * H))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cd.dof.focus_distance = (target - cam.location).length
    sc.render.filepath = f'{prefix}-{name}.png'
    bpy.ops.render.render(write_still=True); print('rendered', sc.render.filepath)

shoot('34', -28, 0.55)
shoot('side', -48, 0.4)
