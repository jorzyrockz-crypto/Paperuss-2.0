import re
with open('features.css', 'r', encoding='utf-8') as f:
    text = f.read()

bad = '.calculeaf-edge-control{\n  position:fixed;display:none;align-items:center;justify-content:center;\n  width:14px;height:14px;transform:translate(-50%,-50%);z-index:225;\n  border-radius:999px;font:700 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;align-items:center;justify-content:center;z-index:140;'
good = '.block-gutter{\n  position:fixed;display:none;align-items:center;justify-content:center;z-index:140;'
text = text.replace(bad, good)

actual_target = '.calculeaf-edge-control{\n  position:fixed;display:none;align-items:center;justify-content:center;\n  width:20px;height:20px;transform:translate(-50%,-50%);z-index:225;\n  border-radius:999px;font:700 15px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
actual_replacement = '.calculeaf-edge-control{\n  position:fixed;display:none;align-items:center;justify-content:center;\n  width:14px;height:14px;transform:translate(-50%,-50%);z-index:225;\n  border-radius:999px;font:700 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
text = text.replace(actual_target, actual_replacement)

with open('features.css', 'w', encoding='utf-8') as f:
    f.write(text)
print("done")
