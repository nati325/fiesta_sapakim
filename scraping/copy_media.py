import shutil
import os

src = r"c:\Users\123\Desktop\scarping_for_fiesta\media_fiesta"
dst = r"c:\Users\123\Desktop\scarping_for_fiesta\public\media"

if not os.path.exists(dst):
    os.makedirs(dst)

files = os.listdir(src)
print(f"Copying {len(files)} files...")

for f in files:
    src_file = os.path.join(src, f)
    # Rename to simple names
    if "Video" in f and "47" in f:
        dst_name = "vid1.mp4"
    elif "Video" in f and "54" in f:
        dst_name = "vid2.mp4"
    elif "Image" in f and "18" in f:
        dst_name = "img1.jpg"
    elif "Image" in f and "25" in f:
        dst_name = "img2.jpg"
    elif "Image" in f and "29" in f:
        dst_name = "img3.jpg"
    else:
        dst_name = f
        
    dst_file = os.path.join(dst, dst_name)
    shutil.copy2(src_file, dst_file)
    print(f"Copied {f} to {dst_name}")

print("Done!")
