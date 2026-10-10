"""Build pokeidle/hooks/data/gen1.js from the PokeAPI CSV dump.

Usage: python -I tools/gendata.py <raw_dir> <out_js>

Everything is reduced to Generation 1 (Red/Blue): 151 species, 165 moves with their
original Gen 1 type/power/accuracy, Red/Blue level-up learnsets, evolutions and the
Red/Blue wild encounter tables grouped into the zones the idle game walks through.
"""
import csv, json, sys

RAW, OUT = sys.argv[1], sys.argv[2]


def rows(name):
    with open(f'{RAW}/{name}.csv', encoding='utf-8') as fh:
        return list(csv.DictReader(fh))


TYPES = ['normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost',
         'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon']
type_name = {r['id']: r['identifier'] for r in [
    {'id': str(i), 'identifier': n} for i, n in enumerate(
        ['normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
         'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'], 1)]}


def tidx(type_id):
    return TYPES.index(type_name[type_id])


# ---- Type chart (Gen 1, with Ghost hitting Psychic super effectively as intended) ----
chart = [[1.0] * len(TYPES) for _ in TYPES]
for r in rows('type_efficacy'):
    a, d = type_name[r['damage_type_id']], type_name[r['target_type_id']]
    if a in TYPES and d in TYPES:
        chart[TYPES.index(a)][TYPES.index(d)] = int(r['damage_factor']) / 100
T = TYPES.index
chart[T('bug')][T('poison')] = 2.0
chart[T('poison')][T('bug')] = 2.0
chart[T('ice')][T('fire')] = 1.0
chart[T('ghost')][T('psychic')] = 2.0

# ---- Names ----
species_name = {int(r['pokemon_species_id']): r['name'] for r in rows('pokemon_species_names')
                if r['local_language_id'] == '9'}
move_name = {int(r['move_id']): r['name'] for r in rows('move_names') if r['local_language_id'] == '9'}

# ---- Moves, reverted to their Gen 1 values ----
vg_order = {r['id']: int(r['order']) for r in rows('version_groups')}
changes = {}
for r in rows('move_changelog'):
    changes.setdefault(int(r['move_id']), []).append(r)
meta = {int(r['move_id']): r for r in rows('move_meta')}
stat_changes = {}
for r in rows('move_meta_stat_changes'):
    stat_changes.setdefault(int(r['move_id']), []).append((int(r['stat_id']), int(r['change'])))
STAT = {2: 'atk', 3: 'def', 4: 'spc', 5: 'spc', 6: 'spe', 7: 'acc', 8: 'eva'}
AIL = {'1': 'par', '2': 'slp', '3': 'frz', '4': 'brn', '5': 'psn', '6': 'cnf'}
PHYSICAL = {'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost'}

moves = {}
for r in rows('moves'):
    mid = int(r['id'])
    if mid > 165:
        continue
    vals = {k: r[k] for k in ('type_id', 'power', 'pp', 'accuracy', 'effect_chance')}
    # The changelog row of the earliest change holds the value the move had before it
    for c in sorted(changes.get(mid, []), key=lambda c: vg_order[c['changed_in_version_group_id']], reverse=True):
        for k in vals:
            if c.get(k):
                vals[k] = c[k]
    t = type_name[vals['type_id']]
    if t not in TYPES:
        t = 'normal'
    m = meta.get(mid, {})
    power = int(vals['power']) if vals['power'] else 0
    mv = {
        'n': move_name[mid],
        't': TYPES.index(t),
        'p': power,
        'a': int(vals['accuracy']) if vals['accuracy'] else 0,
        'pp': int(vals['pp']) if vals['pp'] else 10,
        'k': 0 if power == 0 else (1 if t in PHYSICAL else 2),
    }
    if int(r['priority']):
        mv['pr'] = int(r['priority'])
    if r['target_id'] == '7':
        mv['self'] = 1
    ail = AIL.get(m.get('meta_ailment_id', '0'))
    if ail:
        mv['ail'] = ail
        chance = int(m.get('ailment_chance') or 0)
        mv['ac'] = chance if chance else 100
    sc = [[STAT[s], ch] for s, ch in stat_changes.get(mid, []) if s in STAT]
    if sc:
        # Gen 1 Growth raises Special by one stage; dedupe spc entries
        seen, uniq = set(), []
        for s, ch in sc:
            if s not in seen:
                seen.add(s)
                uniq.append([s, ch])
        mv['st'] = uniq
        chance = int(m.get('stat_chance') or 0)
        if chance:
            mv['sc'] = chance
    for key, out in (('drain', 'dr'), ('healing', 'hl'), ('crit_rate', 'cr'), ('flinch_chance', 'fl')):
        v = int(m.get(key) or 0)
        if v:
            mv[out] = v
    if m.get('min_hits'):
        mv['hits'] = [int(m['min_hits']), int(m['max_hits'])]
    if m.get('meta_category_id') == '9':
        mv['ohko'] = 1
    moves[mid] = mv

FIXED = {49: 20, 82: 40}
for mid, dmg in FIXED.items():
    moves[mid]['fix'] = dmg
for mid in (69, 101):  # Seismic Toss, Night Shade: damage equal to level
    moves[mid]['fix'] = 'lvl'
moves[162]['fix'] = 'half'      # Super Fang
moves[149]['fix'] = 'psy'       # Psywave
for mid in (120, 153):          # Self-Destruct, Explosion
    moves[mid]['boom'] = 1
# Moves that charge or recharge for a turn in Gen 1. The idle engine plays them in
# one turn, so they hit for half their power to keep the same damage per turn.
for mid in (13, 19, 63, 76, 91, 130, 143):  # Razor Wind, Fly, Hyper Beam, Solar Beam, Dig, Skull Bash, Sky Attack
    moves[mid]['two'] = 1
moves[138]['dream'] = 1         # Dream Eater only works on a sleeping target
for mid in (18, 46, 100):       # Whirlwind, Roar, Teleport: a wild Pokémon flees
    moves[mid]['flee'] = 1
moves[118]['metro'] = 1         # Metronome: a random move
moves[114]['haze'] = 1          # Haze: every stat stage back to zero
# Reflect and Light Screen double Defense and Special: two stages on the user
moves[115]['st'] = [['def', 2]]
moves[115]['self'] = 1
moves[113]['st'] = [['spc', 2]]
moves[113]['self'] = 1
for mid in (63,):               # Hyper Beam has no recharge in this idle version
    pass
moves[105]['hl'] = 50           # Recover
moves[135]['hl'] = 50           # Soft-Boiled
moves[156]['hl'] = 100          # Rest (also puts the user to sleep, handled by the engine)
moves[156]['rest'] = 1

# ---- Species ----
past = {}
for r in rows('pokemon_types_past'):
    pid = int(r['pokemon_id'])
    past.setdefault(pid, {}).setdefault(int(r['generation_id']), []).append((int(r['slot']), r['type_id']))
types = {}
for r in rows('pokemon_types'):
    pid = int(r['pokemon_id'])
    if pid <= 151:
        types.setdefault(pid, []).append((int(r['slot']), r['type_id']))
for pid, by_gen in past.items():
    if pid <= 151:
        types[pid] = by_gen[min(by_gen)]
stats = {}
for r in rows('pokemon_stats'):
    pid = int(r['pokemon_id'])
    if pid <= 151:
        stats.setdefault(pid, {})[int(r['stat_id'])] = int(r['base_stat'])
species_rows = {int(r['id']): r for r in rows('pokemon_species')}
base_exp = {int(r['id']): int(r['base_experience'] or 0) for r in rows('pokemon')}

learn = {}
for r in rows('pokemon_moves'):
    pid = int(r['pokemon_id'])
    if pid <= 151 and r['version_group_id'] == '1' and r['pokemon_move_method_id'] == '1':
        learn.setdefault(pid, set()).add((int(r['level']), int(r['move_id'])))

items = {r['id']: r['identifier'] for r in rows('items')}
evos = {}
for r in rows('pokemon_evolution'):
    to = int(r['evolved_species_id'])
    if to > 151 or r['version_group_id'] not in ('1', ''):
        continue
    frm = int(species_rows[to]['evolves_from_species_id'] or 0)
    if not frm or frm > 151:
        continue
    trig = r['evolution_trigger_id']
    if trig == '1' and r['minimum_level']:
        evos.setdefault(frm, []).append({'to': to, 'lvl': int(r['minimum_level'])})
    elif trig == '3':
        evos.setdefault(frm, []).append({'to': to, 'item': items[r['trigger_item_id']]})
    elif trig == '2':
        evos.setdefault(frm, []).append({'to': to, 'item': 'link-cable'})

species = [None]
for i in range(1, 152):
    s = species_rows[i]
    t = [tidx(tid) for _, tid in sorted(types[i])]
    st = stats[i]
    entry = {
        'n': species_name[i],
        't': t,
        'b': [st[1], st[2], st[3], st[4], st[6]],
        'g': int(s['growth_rate_id']),
        'c': int(s['capture_rate']),
        'x': base_exp[i],
        'm': sorted(learn.get(i, [])),
    }
    if s['is_legendary'] == '1' or s['is_mythical'] == '1':
        entry['leg'] = 1
    if i in evos:
        entry['e'] = evos[i]
    species.append(entry)

# ---- Encounters, grouped into zones ----
locs = {r['id']: r['identifier'] for r in rows('locations')}
areas = {r['id']: locs[r['location_id']] + ('/' + r['identifier'] if r['identifier'] else '') for r in rows('location_areas')}
slots = {r['id']: r for r in rows('encounter_slots')}
methods = {r['id']: r['identifier'] for r in rows('encounter_methods')}
enc = {}
for r in rows('encounters'):
    if r['version_id'] not in ('1', '2'):  # Red and Blue
        continue
    s = slots[r['encounter_slot_id']]
    m = methods[s['encounter_method_id']]
    if m not in ('walk', 'surf', 'old-rod', 'good-rod', 'super-rod'):
        continue
    key = (areas[r['location_area_id']], m)
    bucket = enc.setdefault(key, {})
    pid, lo, hi, w = int(r['pokemon_id']), int(r['min_level']), int(r['max_level']), int(s['rarity'])
    # Red and Blue share slots; merge both versions so each zone has every species
    if pid in bucket:
        b = bucket[pid]
        bucket[pid] = [min(b[0], lo), max(b[1], hi), max(b[2], w)]
    else:
        bucket[pid] = [lo, hi, w]

# name, areas, badges needed, gym key that the zone leads to (if any)
ZONES = [
    ('route-1', 'Route 1', ['kanto-route-1'], 0),
    ('route-22', 'Route 22', ['kanto-route-22'], 0),
    ('route-2', 'Route 2', ['kanto-route-2/south-towards-viridian-city'], 0),
    ('viridian-forest', 'Viridian Forest', ['viridian-forest'], 0),
    ('route-3', 'Route 3', ['kanto-route-3'], 1),
    ('mt-moon', 'Mt. Moon', ['mt-moon/1f', 'mt-moon/b1f', 'mt-moon/b2f'], 1),
    ('route-4', 'Route 4', ['kanto-route-4', 'cerulean-city'], 1),
    ('route-24', 'Routes 24-25', ['kanto-route-24', 'kanto-route-25'], 1),
    ('route-5', 'Routes 5-6', ['kanto-route-5', 'kanto-route-6', 'vermilion-city'], 2),
    ('route-11', 'Route 11', ['kanto-route-11'], 2),
    ('digletts-cave', "Diglett's Cave", ['digletts-cave'], 2),
    ('route-9', 'Routes 9-10', ['kanto-route-9', 'kanto-route-10'], 3),
    ('rock-tunnel', 'Rock Tunnel', ['rock-tunnel/b1f', 'rock-tunnel/b2f'], 3),
    ('route-7', 'Routes 7-8', ['kanto-route-7', 'kanto-route-8', 'celadon-city'], 3),
    ('pokemon-tower', 'Pokémon Tower', ['pokemon-tower/3f', 'pokemon-tower/4f', 'pokemon-tower/5f', 'pokemon-tower/6f', 'pokemon-tower/7f'], 4),
    ('route-12', 'Routes 12-15', ['kanto-route-12', 'kanto-route-13', 'kanto-route-14', 'kanto-route-15'], 4),
    ('route-16', 'Routes 16-18', ['kanto-route-16', 'kanto-route-17', 'kanto-route-18'], 4),
    ('safari-zone', 'Safari Zone', ['kanto-safari-zone/area-1-east', 'kanto-safari-zone/area-2-north', 'kanto-safari-zone/area-3-west', 'kanto-safari-zone/middle', 'fuchsia-city'], 5),
    ('sea-routes', 'Sea Routes 19-21', ['kanto-sea-route-19', 'kanto-sea-route-20', 'kanto-sea-route-21'], 5),
    ('seafoam-islands', 'Seafoam Islands', ['seafoam-islands/1f', 'seafoam-islands/b1f', 'seafoam-islands/b2f', 'seafoam-islands/b3f', 'seafoam-islands/b4f'], 5),
    ('pokemon-mansion', 'Pokémon Mansion', ['pokemon-mansion/1f', 'pokemon-mansion/2f', 'pokemon-mansion/3f', 'pokemon-mansion/b1f', 'cinnabar-island'], 6),
    ('power-plant', 'Power Plant', ['kanto-power-plant'], 6),
    ('route-23', 'Route 23', ['kanto-route-23'], 8),
    ('victory-road', 'Victory Road', ['kanto-victory-road-2/1f', 'kanto-victory-road-2/2f', 'kanto-victory-road-2/3f'], 8),
    ('cerulean-cave', 'Cerulean Cave', ['cerulean-cave/1f', 'cerulean-cave/2f', 'cerulean-cave/b1f'], 9),
]
# Legendary and special encounters Red/Blue place as static Pokémon
STATIC = {'route-12': [143, 30], 'route-16': [143, 30], 'power-plant': [145, 50], 'seafoam-islands': [144, 50],
          'victory-road': [146, 50], 'cerulean-cave': [150, 70]}

zones = []
for zid, name, area_list, badges in ZONES:
    z = {'id': zid, 'n': name, 'badges': badges}
    for m in ('walk', 'surf', 'old-rod', 'good-rod', 'super-rod'):
        merged = {}
        for a in area_list:
            for pid, (lo, hi, w) in enc.get((a, m), {}).items():
                if pid in merged:
                    b = merged[pid]
                    merged[pid] = [min(b[0], lo), max(b[1], hi), b[2] + w]
                else:
                    merged[pid] = [lo, hi, w]
        if merged:
            z[m] = [[pid, lo, hi, w] for pid, (lo, hi, w) in sorted(merged.items())]
    if 'walk' not in z and 'surf' not in z:
        raise SystemExit('zone without wild encounters: ' + zid)
    lv = [e[1] for e in z.get('walk', z.get('surf'))] + [e[2] for e in z.get('walk', z.get('surf'))]
    z['lv'] = [min(lv), max(lv)]
    if zid in STATIC:
        z['static'] = STATIC[zid]
    zones.append(z)

# Make sure every species can be obtained: wild, evolution, or a gift the game sells
GIFTS = [1, 4, 7, 106, 107, 131, 133, 137, 138, 140, 142, 147, 122, 124, 83, 108, 151]
obtainable = set(GIFTS)
for z in zones:
    for m in ('walk', 'surf', 'old-rod', 'good-rod', 'super-rod'):
        obtainable.update(e[0] for e in z.get(m, []))
    if 'static' in z:
        obtainable.add(z['static'][0])
changed = True
while changed:
    changed = False
    for i in list(obtainable):
        for e in species[i].get('e', []):
            if e['to'] not in obtainable:
                obtainable.add(e['to'])
                changed = True
missing = sorted(set(range(1, 152)) - obtainable)
if missing:
    raise SystemExit('unobtainable species: ' + str(missing))


def js(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':'))


with open(OUT, 'w', encoding='utf-8') as fh:
    fh.write('// Generated by tools/gendata.py from the PokeAPI CSV dump. Do not edit.\n')
    fh.write('export const TYPES = ' + js(TYPES) + '\n')
    fh.write('export const CHART = ' + js(chart) + '\n')
    fh.write('export const SPECIES = ' + js(species) + '\n')
    fh.write('export const MOVES = ' + js([None] + [moves[i] for i in range(1, 166)]) + '\n')
    fh.write('export const ZONES = ' + js(zones) + '\n')
    fh.write('export const GIFTS = ' + js(GIFTS) + '\n')
print('ok', len(species) - 1, 'species', len(moves), 'moves', len(zones), 'zones')
