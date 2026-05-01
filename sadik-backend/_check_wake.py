import sqlite3, os
db = "sadik.db"
print(f"DB: {os.path.abspath(db)}, exists={os.path.isfile(db)}")
c = sqlite3.connect(db)
rows = list(c.execute("SELECT key,value FROM settings WHERE key IN ('wake_model_path','wake_threshold','wake_input_gain')"))
print("Settings:", rows)
wp = next((v for k,v in rows if k=='wake_model_path'), "")
if wp:
    abs_path = wp if os.path.isabs(wp) else os.path.join(os.path.dirname(__file__), "app", wp)
    print(f"Resolved path: {abs_path}, exists={os.path.isfile(abs_path)}")
print("wake_models/ contents:", os.listdir(os.path.join(os.path.dirname(__file__), "app", "wake_models")))
