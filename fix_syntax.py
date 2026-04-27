import re
with open('dashboard.html', 'rb') as f:
    content = f.read()

before = content.count(b'days[0])') + content.count(b'days[1])')
content = re.sub(rb'days(\[0\])\)', rb'days[0]', content)
content = re.sub(rb'days(\[1\])\)', rb'days[1]', content)
after = content.count(b'days[0])') + content.count(b'days[1])')
print(f"Fixed: {before} -> {after}")

with open('dashboard.html', 'wb') as f:
    f.write(content)
