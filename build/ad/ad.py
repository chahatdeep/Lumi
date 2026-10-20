# Blender Cycles scenes for the 15 s Lumi ad (1920x1080, 30 fps).
# Usage: blender -b -P build/ad/ad.py -- <shot> <mesh.stl> <out_dir> [samples] [test_frame]
#   shot: litho  - framed lithophane on a desk; room light fades, lamp switches on, camera dolly
#         bust   - Pop 3D bust on a dark studio sweep, turntable
#         lamp   - cylinder lithophane lamp glowing from inside, turntable
# test_frame renders that one frame only (for look checks).
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
shot, stl, out = argv[0], argv[1], argv[2]
samples = int(argv[3]) if len(argv) > 3 else 96
test = int(argv[4]) if len(argv) > 4 else None
FRAMES = {'litho': 96, 'bust': 105, 'lamp': 90}[shot]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.frame_start, sc.frame_end = int(os.environ.get('FSTART', '1')), FRAMES
sc.render.fps = 30

# ---------------------------------------------------------------- helpers
def look(o, target):
    o.rotation_euler = (Vector(target) - o.location).to_track_quat('-Z', 'Y').to_euler()

def area(name, size, loc, aim, energy, color, sy=None):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.color = color
    l.shape = 'RECTANGLE'; l.size = size; l.size_y = sy or size
    o = bpy.data.objects.new(name, l); sc.collection.objects.link(o)
    o.location = loc; look(o, aim)
    return o

def key(datablock, path, frame, value):
    setattr(datablock, path, value) if not isinstance(value, tuple) else None
    if isinstance(value, tuple):
        getattr(datablock, path)[:] = value
    datablock.keyframe_insert(data_path=path, frame=frame)

def smooth_keys(obj):
    ad = obj.animation_data
    if ad and ad.action:
        for fc in getattr(ad.action, 'fcurves', []):
            for kp in fc.keyframe_points: kp.interpolation = 'BEZIER'; kp.easing = 'EASE_IN_OUT'

def import_stl(path):
    bpy.ops.wm.stl_import(filepath=path)
    o = bpy.context.selected_objects[0]
    o.scale = (0.001,) * 3
    bpy.context.view_layer.update()
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector([min(v[i] for v in bb) for i in range(3)]); mx = Vector([max(v[i] for v in bb) for i in range(3)])
    o.location -= Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    bpy.context.view_layer.update()
    return o, mx - mn

def lithophane_pla(sss=0.00009):
    m = bpy.data.materials.new('WhitePLA'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.92, 0.91, 0.88, 1)
    b.inputs['Roughness'].default_value = 0.42
    b.inputs['Subsurface Weight'].default_value = 1.0
    b.inputs['Subsurface Radius'].default_value = (1.0, 0.93, 0.86)
    b.inputs['Subsurface Scale'].default_value = sss
    b.subsurface_method = 'RANDOM_WALK'
    return m

def wood():
    m = bpy.data.materials.new('Wood'); m.use_nodes = True
    nt = m.node_tree; wb = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (40, 2.2, 40)
    wv = nt.nodes.new('ShaderNodeTexWave'); wv.inputs['Scale'].default_value = 3.0; wv.inputs['Distortion'].default_value = 6.0; wv.inputs['Detail'].default_value = 3
    rp = nt.nodes.new('ShaderNodeValToRGB')
    rp.color_ramp.elements[0].color = (0.09, 0.05, 0.028, 1); rp.color_ramp.elements[1].color = (0.22, 0.13, 0.07, 1)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], wv.inputs['Vector'])
    nt.links.new(wv.outputs['Fac'], rp.inputs['Fac']); nt.links.new(rp.outputs['Color'], wb.inputs['Base Color'])
    wb.inputs['Roughness'].default_value = 0.32
    return m

def plain(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough
    return m

def plane(size, loc, rot, mat):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rot)
    bpy.context.object.data.materials.append(mat); return bpy.context.object

def world(rgb, strength):
    w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (*rgb, 1); bg.inputs['Strength'].default_value = strength
    return bg

def camera(lens, fstop):
    cd = bpy.data.cameras.new('Cam'); cd.lens = lens; cd.dof.use_dof = True; cd.dof.aperture_fstop = fstop
    cam = bpy.data.objects.new('Cam', cd); sc.collection.objects.link(cam); sc.camera = cam
    return cam, cd

WARM = (1.0, 0.66, 0.36); DAY = (1.0, 0.95, 0.9); NEUTRAL = (1.0, 0.82, 0.66)

# ---------------------------------------------------------------- shots
if shot == 'litho':
    obj, size = import_stl(stl); bpy.ops.object.shade_flat()
    obj.data.materials.append(lithophane_pla())
    W, D, H = size
    plane(1.6, (0, 0.15, 0), (0, 0, 0), wood())
    plane(2.0, (0, 0.32, 0.5), (math.radians(90), 0, 0), plain('Wall', (0.30, 0.28, 0.27)))
    led = area('LED', W * 0.95, (0, D / 2 + 0.03, H * 0.55), (0, -1, H * 0.55), 5.0, WARM, sy=H * 0.9)
    win = area('Window', 0.9, (-0.9, -0.9, 0.9), (0, 0, H * 0.5), 45, DAY)
    fill = area('Fill', 0.6, (0.7, -0.6, 0.4), (0, 0, H * 0.5), 6, NEUTRAL)
    bg = world((0.02, 0.022, 0.03), 0.4)
    # 0-0.8 s daylight relief, 0.8-1.8 s room dims while the lamp comes up
    for f, led_e, win_e, fill_e, w_s in [(1, 0.0, 45, 6, 0.4), (24, 0.0, 45, 6, 0.4), (54, 5.0, 0.6, 0.15, 0.05), (FRAMES, 5.0, 0.6, 0.15, 0.05)]:
        led.data.energy = led_e; led.data.keyframe_insert('energy', frame=f)
        win.data.energy = win_e; win.data.keyframe_insert('energy', frame=f)
        fill.data.energy = fill_e; fill.data.keyframe_insert('energy', frame=f)
        bg.inputs['Strength'].default_value = w_s; bg.inputs['Strength'].keyframe_insert('default_value', frame=f)
    cam, cd = camera(85, 5.6)
    tgt = Vector((0, 0, H * 0.52))
    for f, off in [(1, Vector((-0.20, -0.62, 0.09))), (FRAMES, Vector((-0.09, -0.50, 0.05)))]:
        cam.location = tgt + off; look(cam, tgt); cam.keyframe_insert('location', frame=f); cam.keyframe_insert('rotation_euler', frame=f)
        cd.dof.focus_distance = off.length; cd.dof.keyframe_insert('focus_distance', frame=f)
    smooth_keys(cam)

elif shot == 'bust':
    obj, size = import_stl(stl); bpy.ops.object.shade_smooth()
    m = bpy.data.materials.new('PLA'); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.80, 0.77, 0.72, 1); b.inputs['Roughness'].default_value = 0.48
    b.inputs['Subsurface Weight'].default_value = 0.15; b.inputs['Subsurface Scale'].default_value = 0.0004
    tc = nt.nodes.new('ShaderNodeTexCoord'); wave = nt.nodes.new('ShaderNodeTexWave'); wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 1 / 0.12; wave.inputs['Distortion'].default_value = 0.0
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.12; bump.inputs['Distance'].default_value = 0.00004
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector']); nt.links.new(wave.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    obj.data.materials.append(m)
    H = size.z
    # turntable: parent to an empty at the origin
    pivot = bpy.data.objects.new('Pivot', None); sc.collection.objects.link(pivot); obj.parent = pivot
    pivot.rotation_euler = (0, 0, math.radians(-40)); pivot.keyframe_insert('rotation_euler', frame=1)
    pivot.rotation_euler = (0, 0, math.radians(40)); pivot.keyframe_insert('rotation_euler', frame=FRAMES)
    for fc in pivot.animation_data.action.fcurves if hasattr(pivot.animation_data.action, 'fcurves') else []:
        for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'
    # dark seamless sweep
    tone = 0.006  # near-black studio with a glossy floor
    bpy.ops.mesh.primitive_plane_add(size=1); sw = bpy.context.object; sw.data.materials.append(plain('Sweep', (tone, tone, tone), 0.22))
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.subdivide(number_cuts=60); bpy.ops.object.mode_set(mode='OBJECT')
    R, back = 0.35, 0.45
    for v in sw.data.vertices:
        x, y = v.co.x * 8.0, (v.co.y + 0.5) * 2.0 - 1.0
        if y < 0: v.co = Vector((x, back + y * 1.5, 0))
        else:
            t = y * (math.pi / 2 + 1.5)
            v.co = Vector((x, back + R * math.sin(t), R - R * math.cos(t))) if t < math.pi / 2 else Vector((x, back + R, R + (t - math.pi / 2)))
    bpy.ops.object.shade_smooth()
    area('Key', 0.5, (-0.5, -0.05, 0.3), (0, 0, H * 0.55), 16, (1.0, 0.97, 0.94))
    area('Fill', 0.8, (0.6, -0.4, 0.2), (0, 0, H * 0.5), 1.5, (0.92, 0.95, 1.0))
    area('RimWarm', 0.15, (0.22, 0.16, 0.22), (0, 0, H * 0.7), 14, (1.0, 0.62, 0.3))   # warm rim
    area('RimCool', 0.3, (-0.3, 0.25, 0.25), (0, 0, H * 0.7), 8, (0.7, 0.8, 1.0))
    world((0, 0, 0), 0.0)
    cam, cd = camera(85, 4.0)
    tgt = Vector((0, 0, H * 0.47))
    for f, off in [(1, Vector((0.02, -0.52, 0.06))), (FRAMES, Vector((0.0, -0.45, 0.045)))]:
        cam.location = tgt + off; look(cam, tgt); cam.keyframe_insert('location', frame=f); cam.keyframe_insert('rotation_euler', frame=f)
        cd.dof.focus_distance = off.length; cd.dof.keyframe_insert('focus_distance', frame=f)
    smooth_keys(cam)

elif shot == 'lamp':
    obj, size = import_stl(stl); bpy.ops.object.shade_flat()
    obj.data.materials.append(lithophane_pla())
    H = size.z
    pivot = bpy.data.objects.new('Pivot', None); sc.collection.objects.link(pivot); obj.parent = pivot
    pivot.rotation_euler = (0, 0, math.radians(0)); pivot.keyframe_insert('rotation_euler', frame=1)
    pivot.rotation_euler = (0, 0, math.radians(75)); pivot.keyframe_insert('rotation_euler', frame=FRAMES)
    plane(1.6, (0, 0.15, 0), (0, 0, 0), wood())
    plane(2.0, (0, 0.40, 0.5), (math.radians(90), 0, 0), plain('Wall', (0.22, 0.20, 0.19)))
    # warm bulb inside the lamp
    bulb = bpy.data.lights.new('Bulb', 'POINT'); bulb.energy = 9.0; bulb.color = WARM; bulb.shadow_soft_size = 0.012
    bo = bpy.data.objects.new('Bulb', bulb); sc.collection.objects.link(bo); bo.location = (0, 0, H * 0.45)
    area('Moon', 0.8, (0.6, -0.8, 0.7), (0, 0, H * 0.5), 1.2, (0.75, 0.82, 1.0))   # faint cool room light
    world((0.02, 0.022, 0.03), 0.04)
    cam, cd = camera(70, 4.0)
    tgt = Vector((0, 0, H * 0.48))
    for f, off in [(1, Vector((-0.13, -0.54, 0.03))), (FRAMES, Vector((-0.07, -0.47, 0.06)))]:
        cam.location = tgt + off; look(cam, tgt); cam.keyframe_insert('location', frame=f); cam.keyframe_insert('rotation_euler', frame=f)
        cd.dof.focus_distance = off.length - 0.04; cd.dof.keyframe_insert('focus_distance', frame=f)
    smooth_keys(cam)

# linear turntables
for o in sc.objects:
    if o.name == 'Pivot' and o.animation_data:
        act = o.animation_data.action
        curves = getattr(act, 'fcurves', None)
        if curves is None:  # Blender 5 layered actions
            curves = [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
        for fc in curves:
            for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'

# ---------------------------------------------------------------- render
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
cy.use_adaptive_sampling = True; cy.adaptive_threshold = float(os.environ.get('NOISE', '0.004')); cy.adaptive_min_samples = 64
cy.denoiser = 'OPENIMAGEDENOISE'; cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'; cy.denoising_prefilter = 'ACCURATE'
cy.max_bounces = 12; cy.transmission_bounces = 12
sc.render.use_persistent_data = True
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.resolution_percentage = int(os.environ.get('RES', '100'))
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
sc.render.image_settings.file_format = 'PNG'
os.makedirs(out, exist_ok=True)
if test:
    sc.frame_set(test); sc.render.filepath = os.path.join(out, f'test-{test:04d}.png')
    bpy.ops.render.render(write_still=True)
else:
    sc.render.filepath = os.path.join(out, '')
    bpy.ops.render.render(animation=True)
print('done', shot)
