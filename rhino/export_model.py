import json
import Rhino
import Rhino.Geometry as rg
from Rhino import RhinoMath, UnitSystem

scale = RhinoMath.UnitScale(Rhino.RhinoDoc.ActiveDoc.ModelUnitSystem, UnitSystem.Millimeters)

tolerance = tol if tol else 0.01
tolerance = tolerance * scale

node_index = {}
nodes = []


def node_id(pt):
    x, y, z = pt.X * scale, pt.Y * scale, pt.Z * scale
    key = (int(round(x / tolerance)), int(round(y / tolerance)), int(round(z / tolerance)))
    if key not in node_index:
        node_index[key] = len(nodes) + 1
        nodes.append({"id": len(nodes) + 1, "xyz": [x, y, z]})
    return node_index[key]


bars = []
for crv in (curves or []):
    if crv is None:
        continue
    segs = crv.DuplicateSegments() if hasattr(crv, "DuplicateSegments") else [crv]
    if not segs:
        segs = [crv]
    for s in segs:
        a = node_id(s.PointAtStart)
        b = node_id(s.PointAtEnd)
        if a != b:
            bars.append({"id": len(bars) + 1, "n": [a, b], "mat": "steel", "sec": "bar_default"})

panels = []
for i, m in enumerate(meshes or []):
    if m is None:
        continue
    tris = []
    for f in m.Faces:
        ids = [node_id(m.Vertices[f.A]), node_id(m.Vertices[f.B]), node_id(m.Vertices[f.C])]
        tris.append(ids)
        if f.IsQuad:
            tris.append([ids[0], ids[2], node_id(m.Vertices[f.D])])
    panels.append({"id": "P%d" % (i + 1), "mat": "steel", "sec": "shell_default", "tris": tris})

model = {
    "units": {"length": "mm", "force": "N", "mass": "tonne", "time": "s"},
    "materials": [{"id": "steel", "E": 205000.0, "nu": 0.3, "rho": 7.85e-9}],
    "sections": [
        {"id": "bar_default", "type": "bar", "A": 10000.0, "Iy": 1.0e8, "Iz": 1.0e8, "J": 2.0e8},
        {"id": "shell_default", "type": "shell", "thickness": 10.0}
    ],
    "nodes": nodes,
    "bars": bars,
    "panels": panels,
    "hinges": [],
    "masses": [],
    "supports": [],
    "damping": {"mode": "modal", "xi": 0.05, "rayleigh": None}
}

text = json.dumps(model, indent=1)

if write and path:
    with open(path, "w") as fp:
        fp.write(text)

a = text
