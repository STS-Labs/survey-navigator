"""Build data/tbilisi-net.json: the drivable OpenStreetMap street network the navigator snaps routes to.

Usage:  uv run --with osmium python -I tools/build_network.py <georgia-latest.osm.pbf> data/tbilisi-net.json

Keeps every way a car can use (plus service roads, which survey routes do drive), with
name, one-way, roundabout and access flags, and the node-via turn restrictions inside the box.
"""
import json, sys
import osmium

S, W, N, E = 41.60, 44.60, 41.86, 45.10          # Tbilisi, generous
CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
           "living_street", "service", "motorway_link", "trunk_link", "primary_link",
           "secondary_link", "tertiary_link", "road"]
CLS = {c: i for i, c in enumerate(CLASSES)}
NO_ACCESS = {"no", "private"}
RESTR = {"no_left_turn": 1, "no_right_turn": 2, "no_straight_on": 3, "no_u_turn": 4,
         "only_left_turn": 5, "only_right_turn": 6, "only_straight_on": 7, "no_entry": 8, "no_exit": 9}

pbf, out = sys.argv[1], sys.argv[2]
ways, restr = [], []


class Reader(osmium.SimpleHandler):
    def way(self, w):
        hw = w.tags.get("highway")
        if hw not in CLS:
            return
        try:
            locs = [(n.ref, round(n.location.lat, 7), round(n.location.lon, 7)) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(locs) < 2 or not any(S <= la <= N and W <= lo <= E for _, la, lo in locs):
            return
        t = w.tags
        ow = t.get("oneway", "")
        junction = t.get("junction", "")
        if ow in ("yes", "1", "true"):
            oneway = 1
        elif ow in ("-1", "reverse"):
            oneway = -1
        elif ow == "no":
            oneway = 0
        else:
            oneway = 1 if (hw == "motorway" or junction in ("roundabout", "circular")) else 0
        denied = (t.get("access") in NO_ACCESS or t.get("motor_vehicle") in NO_ACCESS
                  or t.get("motorcar") in NO_ACCESS or t.get("vehicle") in NO_ACCESS)
        minor = hw == "service" and t.get("service") in ("parking_aisle", "driveway", "drive-through")
        ways.append({"id": w.id, "cls": CLS[hw], "oneway": oneway,
                     "round": junction in ("roundabout", "circular"), "denied": denied, "minor": minor,
                     "name": t.get("name", ""), "en": t.get("name:en", ""), "ref": t.get("ref", ""),
                     "nodes": locs})

    def relation(self, r):
        kind = r.tags.get("restriction") or r.tags.get("restriction:motorcar")
        if r.tags.get("type") != "restriction" or kind not in RESTR:
            return
        frm = [m.ref for m in r.members if m.role == "from" and m.type == "w"]
        to = [m.ref for m in r.members if m.role == "to" and m.type == "w"]
        via = [m.ref for m in r.members if m.role == "via" and m.type == "n"]
        if len(frm) == 1 and len(to) == 1 and len(via) == 1:   # via-way restrictions are rare; skipped
            restr.append((frm[0], via[0], to[0], RESTR[kind]))


Reader().apply_file(pbf, locations=True)

# Number the nodes we keep, then write everything as small integers.
node_idx, node_xy = {}, []
for w in ways:
    for ref, la, lo in w["nodes"]:
        if ref not in node_idx:
            node_idx[ref] = len(node_xy)
            node_xy.append((round(lo * 1e6), round(la * 1e6)))
flat, px, py = [], 0, 0
for x, y in node_xy:
    flat += [x - px, y - py]
    px, py = x, y

names = [""]
name_id = {"": 0}
def nid(s):
    if s not in name_id:
        name_id[s] = len(names)
        names.append(s)
    return name_id[s]

way_index = {}
way_rows = []
for i, w in enumerate(ways):
    way_index[w["id"]] = i
    flags = (w["cls"] | ((w["oneway"] + 1) << 4) | (int(w["round"]) << 6)
             | (int(w["denied"]) << 7) | (int(w["minor"]) << 8))
    refs = [node_idx[ref] for ref, _, _ in w["nodes"]]
    deltas, prev = [], 0
    for r in refs:
        deltas.append(r - prev)
        prev = r
    way_rows.append([flags, nid(w["name"]), nid(w["en"]), nid(w["ref"])] + deltas)

restr_rows = [[way_index[f], node_idx[v], way_index[t], k] for f, v, t, k in restr
              if f in way_index and t in way_index and v in node_idx]

doc = {
    "v": 1,
    "source": "OpenStreetMap contributors (ODbL), Geofabrik georgia-latest extract",
    "bbox": [W, S, E, N],
    "classes": CLASSES,
    "restrictionKinds": {v: k for k, v in RESTR.items()},
    "nodes": flat,
    "names": names,
    "ways": way_rows,
    "restrictions": restr_rows,
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
print(f"{len(ways)} ways, {len(node_xy)} nodes, {len(names)} names, {len(restr_rows)} restrictions")
