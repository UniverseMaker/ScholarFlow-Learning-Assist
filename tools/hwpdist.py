# -*- coding: utf-8 -*-
"""HWP 5.0 배포용 문서(ViewText) 복호화 + 본문 텍스트 추출."""
import struct, zlib
import olefile
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


class MsRand:
    def __init__(self, seed): self.s = seed & 0xFFFFFFFF
    def rand(self):
        self.s = (self.s * 214013 + 2531011) & 0xFFFFFFFF
        return (self.s >> 16) & 0x7FFF


def decode_dist_record(rec256):
    seed = struct.unpack_from('<I', rec256, 0)[0]
    r = MsRand(seed)
    buf = bytearray(rec256)
    key = 0; cnt = 0
    for i in range(256):
        if cnt == 0:
            key = r.rand() & 0xFF
            cnt = (r.rand() & 0x0F) + 1
        if i >= 4:
            buf[i] ^= key
        cnt -= 1
    off = 4 + (seed & 0x0F)
    return bytes(buf[off:off + 16])


def read_records(data):
    i = 0
    while i + 4 <= len(data):
        h = struct.unpack_from('<I', data, i)[0]
        tag = h & 0x3FF; size = (h >> 20) & 0xFFF; i += 4
        if size == 0xFFF:
            size = struct.unpack_from('<I', data, i)[0]; i += 4
        yield tag, data[i:i + size]
        i += size


def section_bytes(f, path, compressed):
    raw = f.openstream(path).read()
    if path[0] == 'ViewText':
        tag0, rec = next(read_records(raw))
        # 첫 레코드 = HWPTAG_DISTRIBUTE_DOC_DATA (256 bytes)
        key = decode_dist_record(rec[:256])
        hdrlen = 4 + len(rec)
        body = raw[hdrlen:]
        body = body[:len(body) - len(body) % 16]
        dec = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
        raw = dec.update(body) + dec.finalize()
    if compressed:
        d = zlib.decompressobj(-15)
        raw = d.decompress(raw)
    return raw


EQ_COUNTER = [0]


def para_text(rec):
    """문단 텍스트 + 이 문단이 품은 확장 컨트롤 목록 [(ctrl id, 자리표시 키 or None)]"""
    chars = []; ctrls = []; j = 0; n = len(rec) // 2
    while j < n:
        c = struct.unpack_from('<H', rec, j * 2)[0]
        if c < 32:
            if c in (10, 13): chars.append('\n'); j += 1
            elif c == 9: chars.append('\t'); j += 8
            elif c in (0, 24, 25, 26, 27, 28, 29, 30, 31): j += 1
            else:
                # 확장 컨트롤: 뒤 4바이트가 ctrl id(역순). 그림/표/수식 자리를 표시해 둔다.
                cid = rec[(j + 1) * 2:(j + 3) * 2][::-1].decode('latin-1', 'replace')
                key = None
                if cid == 'gso ': chars.append('[[IMG]]')
                elif cid == 'tbl ': chars.append('[[TBL]]')
                elif cid == 'eqed':
                    EQ_COUNTER[0] += 1
                    key = '[[EQ:%d]]' % EQ_COUNTER[0]
                    chars.append(key)
                ctrls.append([cid, key, 0])
                j += 8
            continue
        chars.append(chr(c)); j += 1
    return ''.join(chars), ctrls


def read_records_lv(data):
    i = 0
    while i + 4 <= len(data):
        h = struct.unpack_from('<I', data, i)[0]
        tag = h & 0x3FF; level = (h >> 10) & 0x3FF; size = (h >> 20) & 0xFFF; i += 4
        if size == 0xFFF:
            size = struct.unpack_from('<I', data, i)[0]; i += 4
        yield tag, level, data[i:i + size]
        i += size


def eq_readable(s):
    """HWP 수식 스크립트를 사람이 읽을 만한 평문으로."""
    import re
    s = s.replace('`', ' ').replace('~', ' ')
    rep = [('oplus', '⊕'), ('OPLUS', '⊕'), ('XOR', '⊕'), ('times', '×'), ('TIMES', '×'), ('cdot', '·'),
           ('LEFT', ''), ('RIGHT', ''), ('left', ''), ('right', ''), ('rm', ''), ('it', ''),
           ('SUM', 'Σ'), ('sum', 'Σ'), ('sqrt', '√'), ('SQRT', '√'), ('le', '≤'), ('ge', '≥'), ('ne', '≠'),
           ('alpha', 'α'), ('beta', 'β'), ('lambda', 'λ'), ('pi', 'π'), ('rarrow', '→'), ('->', '→'), ('inf', '∞')]
    for a, b in rep:
        s = re.sub(r'(?<![A-Za-z])' + re.escape(a) + r'(?![A-Za-z])', b, s)
    # 분수: {A} over {B} → (A) / (B)  (한 글자 항은 괄호 없이)
    def frac(m):
        a, b = m.group(1).strip(), m.group(2).strip()
        wrap = lambda x: x if re.fullmatch(r'[A-Za-z0-9]', x) else '(' + x + ')'
        return wrap(a) + ' / ' + wrap(b)
    for _ in range(3):
        s = re.sub(r'\{([^{}]*)\}\s*\bover\b\s*\{([^{}]*)\}', frac, s)
    s = re.sub(r'\s*\bover\b\s*', ' / ', s)
    s = re.sub(r'\s*_\s*', '_', s); s = re.sub(r'\s*\^\s*', '^', s)
    s = re.sub(r'\s+', ' ', s).strip()
    s = s.replace('{ ', '{').replace(' }', '}')
    # 아래·위 첨자 → 유니코드 첨자(표현할 수 없는 글자가 섞이면 _(…)/^(…) 로 남긴다)
    SUB = dict(zip('0123456789+-=()aehijklmnoprstuvxKNT', '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓₖₙₜ'))
    SUP = dict(zip('0123456789+-=()in', '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿ'))

    def conv(m, table, mark):
        body = m.group(1) if m.group(1) is not None else m.group(2)
        b = body.replace(' ', '')
        if b and all(ch in table for ch in b):
            return ''.join(table[ch] for ch in b)
        return mark + ('(' + body + ')' if len(b) > 1 else body)
    s = re.sub(r'_\((\d+)\)', lambda m: '₍' + ''.join(SUB[c] for c in m.group(1)) + '₎', s)   # 0111_(2) 같은 진법 표기
    s = re.sub(r'_(?:\{([^{}]*)\}|([A-Za-z0-9]))', lambda m: conv(m, SUB, '_'), s)
    s = re.sub(r'\^(?:\{([^{}]*)\}|([A-Za-z0-9]))', lambda m: conv(m, SUP, '^'), s)
    s = s.replace('{', '').replace('}', '')
    return s


def _cell_text(parts):
    import re
    # 셀 안 문단은 ¶ 로 잇는다 — 파서가 "한 셀에 ①②③④ 가 문단별로" 든 표를 행으로 펼칠 수 있게
    ps = [re.sub(r'\s{2,}', ' ', x.replace('[[TBL]]', '').replace('\n', ' ').replace('\t', ' ').replace('|', '¦')).strip()
          for x in parts]
    return '¶'.join(p for p in ps if p)


def render_table(t, sink, nested=False):
    """표 → 1×1 이면 상자(본문 그대로), 아니면 ⟪TABLE⟫ 파이프 표. 중첩 표는 한 줄로 압축."""
    rows, cols = t['rows'], t['cols']
    if not t['cells']:
        return
    if rows * cols <= 1 or len(t['cells']) == 1:
        for c in t['cells']:
            sink.extend(c[4])
        return
    grid = [[''] * cols for _ in range(rows)]
    for r, c, rs, cs, parts in t['cells']:
        if r < rows and c < cols:
            grid[r][c] = _cell_text(parts)
    if nested:
        sink.append(' / '.join(' '.join(x for x in row if x) for row in grid))
        return
    sink.append('⟪TABLE⟫')
    for row in grid:
        sink.append('| ' + ' | '.join(row) + ' |')
    sink.append('⟪/TABLE⟫')


def hwp_text(p):
    f = olefile.OleFileIO(p)
    hdr = f.openstream('FileHeader').read()
    props = struct.unpack_from('<I', hdr, 36)[0]
    compressed = bool(props & 1)
    dist = bool(props & 4)
    top = 'ViewText' if dist and f.exists('ViewText/Section0') else 'BodyText'
    secs = sorted([s for s in f.listdir() if s[0] == top], key=lambda s: int(s[1].replace('Section', '')))
    out = []; eqs = {}
    for s in secs:
        data = section_bytes(f, s, compressed)
        pending = {}   # level → 그 레벨 최근 문단의 컨트롤 목록
        cur = {}       # level → 현재 컨트롤 항목
        tables = []    # 열린 표 스택
        target = [out]

        def close_tables(lv):
            while tables and lv <= tables[-1]['ctrl_lv']:
                t = tables.pop()
                target.pop() if t['cell_open'] else None
                render_table(t, target[-1], nested=bool(tables))

        for tag, lv, rec in read_records_lv(data):
            close_tables(lv)
            if tag == 67:
                t, ctrls = para_text(rec)
                target[-1].append(t); pending[lv] = ctrls
            elif tag == 77 and tables and lv == tables[-1]['ctrl_lv'] + 1:
                tables[-1]['rows'], tables[-1]['cols'] = struct.unpack_from('<HH', rec, 4)
            elif tag == 72 and tables and lv == tables[-1]['ctrl_lv'] + 1 and len(rec) >= 16:
                t = tables[-1]
                col, row, cs, rs = struct.unpack_from('<HHHH', rec, 8)
                if t['cell_open']: target.pop()
                cell = []; t['cells'].append((row, col, rs, cs, cell)); t['cell_open'] = True
                target.append(cell)
            if tag == 71 and len(rec) >= 4 and rec[:4][::-1] == b'tbl ':
                tables.append({'ctrl_lv': lv, 'rows': 0, 'cols': 0, 'cells': [], 'cell_open': False})
            if tag == 71 and len(rec) >= 4:
                cid = rec[:4][::-1].decode('latin-1', 'replace')
                lst = pending.get(lv) or []    # PARA_TEXT 와 CTRL_HEADER 는 같은 레벨(둘 다 PARA_HEADER 의 자식)
                for item in lst:
                    if item[2] == 0 and item[0] == cid:
                        item[2] = 1; cur[lv] = item; break
                else:
                    cur[lv] = None
            elif tag == 88 and len(rec) >= 6:
                ln = struct.unpack_from('<H', rec, 4)[0]
                script = rec[6:6 + ln * 2].decode('utf-16-le', 'replace')
                item = cur.get(lv - 1)
                if item and item[1]:
                    eqs[item[1]] = eq_readable(script)
        close_tables(-1)
    text = '\n'.join(out)
    import re
    text = re.sub(r'\[\[EQ:\d+\]\]', lambda m: ('⟦' + eqs[m.group(0)] + '⟧') if m.group(0) in eqs else '[[EQ]]', text)
    return text, len(secs), dist
