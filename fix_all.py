import re
with open('dashboard.html', 'rb') as f:
    content = f.read()

def fix_js_section(data, start_marker, end_marker):
    start = data.find(start_marker)
    end = data.find(end_marker, start)
    if start < 0 or end < 0 or end <= start:
        print(f"NOT FOUND: {start_marker} at {start}, {end_marker} at {end}")
        return data, 0
    section = data[start:end]
    section_str = section.decode('utf-8', errors='replace')
    original = section_str

    # Fix )=> in arrow functions
    fixed = 0
    for fn in ['filter', 'forEach', 'map', 'reduce', 'sort', 'every']:
        before = section_str.count(fn + '()=>')
        section_str = re.sub(fn + r'\((\w+)\)=>', fn + r'(\1)=>', section_str)
        after = section_str.count(fn + '()=>')
        if before != after:
            fixed += before - after

    # Fix days[N]) in conditions
    for n in ['0', '1']:
        section_str = section_str.replace('days[' + n + '])', 'days[' + n + ']')

    if section_str != original:
        data = data[:start] + section_str.encode('utf-8') + data[end:]
    return data, fixed

# Fix MOBILE HYBRID section
content, n1 = fix_js_section(content, b'MOBILE HYBRID', b'UPDATE UI')
print(f"MOBILE HYBRID: fixed {n1} arrow issues")

# Fix UPDATE UI section
content, n2 = fix_js_section(content, b'UPDATE UI', b'FETCH DATA')
print(f"UPDATE UI: fixed {n2} arrow issues")

# Fix FETCH DATA section
content, n3 = fix_js_section(content, b'FETCH DATA', b'fetchData')
print(f"FETCH DATA: fixed {n3} arrow issues")

# Fix fetchData / auto-refresh section
content, n4 = fix_js_section(content, b'fetchData', b'</script>')
print(f"fetchData: fixed {n4} arrow issues")

with open('dashboard.html', 'wb') as f:
    f.write(content)
print(f"Total fixed: {n1+n2+n3+n4}")
