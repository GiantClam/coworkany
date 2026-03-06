import re

with open("src/ipc.rs", "r", encoding="utf-8") as f:
    content = f.read()

content = re.sub(r'(send_command_and_wait\([^)]+\))\?', r'\1.await?', content)

with open("src/ipc.rs", "w", encoding="utf-8") as f:
    f.write(content)
