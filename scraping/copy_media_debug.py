import shutil
import os
import sys

log_file = r"c:\Users\123\Desktop\scarping_for_fiesta\copy_log.txt"
with open(log_file, "w") as log:
    try:
        src = r"c:\Users\123\Desktop\scarping_for_fiesta\media_fiesta"
        dst = r"c:\Users\123\Desktop\scarping_for_fiesta\public\media"

        if not os.path.exists(dst):
            os.makedirs(dst)
            log.write(f"Created {dst}\n")

        files = os.listdir(src)
        log.write(f"Found {len(files)} files in {src}\n")

        for f in files:
            src_file = os.path.join(src, f)
            if "Video" in f and "47" in f: dst_name = "vid1.mp4"
            elif "Video" in f and "54" in f: dst_name = "vid2.mp4"
            elif "Image" in f and "18" in f: dst_name = "img1.jpg"
            elif "Image" in f and "25" in f: dst_name = "img2.jpg"
            elif "Image" in f and "29" in f: dst_name = "img3.jpg"
            else: dst_name = f
            
            dst_file = os.path.join(dst, dst_name)
            shutil.copy2(src_file, dst_file)
            log.write(f"Copied {f} to {dst_name}\n")
        log.write("Success!\n")
    except Exception as e:
        log.write(f"Error: {str(e)}\n")
