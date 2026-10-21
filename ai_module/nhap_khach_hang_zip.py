import os
import sys
import zipfile
import shutil
from dang_ky_chu_nha import train_face_model

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

def find_candidate_zips():
    """Tự động tìm kiếm file dataset_*.zip trong thư mục tải về hoặc Desktop"""
    candidates = []
    search_dirs = [
        os.path.join(os.path.expanduser("~"), "Downloads"),
        os.path.join(os.path.expanduser("~"), "Desktop"),
        os.path.dirname(os.path.dirname(__file__)),
        os.path.dirname(__file__),
    ]
    for d in search_dirs:
        if os.path.exists(d):
            try:
                for f in os.listdir(d):
                    if f.lower().startswith("dataset_") and f.lower().endswith(".zip"):
                        candidates.append(os.path.join(d, f))
            except Exception:
                pass
    return list(dict.fromkeys(candidates))

def import_zip(zip_path):
    zip_path = os.path.abspath(zip_path.strip(' "'))
    if not os.path.exists(zip_path):
        print(f"[!] Khong tim thay file: {zip_path}")
        return False

    base_name = os.path.basename(zip_path)
    # Trich xuat ten chu nha tu ten file: dataset_nguyen_van_a.zip -> nguyen_van_a
    raw_name = base_name.replace(".zip", "").replace(".ZIP", "")
    if raw_name.lower().startswith("dataset_"):
        owner_name = raw_name[8:].strip()
    else:
        owner_name = raw_name.strip()
    
    if not owner_name:
        owner_name = "khach_hang"

    owner_name = owner_name.lower().replace(" ", "_")

    base_dir = os.path.dirname(__file__)
    target_dir = os.path.join(base_dir, "dataset", owner_name)
    os.makedirs(target_dir, exist_ok=True)

    print("=" * 68)
    print(f"[*] DANG GIAI NEN BO DU LIEU MAT CUA CHU NHA: {owner_name.upper()}")
    print(f"[*] Tu file: {zip_path}")
    print(f"[*] Vao thu muc: {target_dir}")
    print("=" * 68)

    extracted_count = 0
    with zipfile.ZipFile(zip_path, 'r') as zf:
        for member in zf.infolist():
            filename = os.path.basename(member.filename)
            if not filename:
                continue
            if filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                target_file = os.path.join(target_dir, filename)
                with zf.open(member) as source, open(target_file, "wb") as target:
                    shutil.copyfileobj(source, target)
                extracted_count += 1

    print(f"[+] Da giai nen thanh cong {extracted_count} buc anh vao he thong!")

    if extracted_count < 20:
        print("[!] Canh bao: So luong anh duoi 20 tam, co the giam do chinh xac AI.")

    print("\n[*] Dang bat dau trich xuat Vector sinh trac hoc Deep Learning (SFace)...")
    train_face_model()
    print("=" * 68)
    print(f"[✓] HOAN TAT 100%! CHU NHA MOI [{owner_name.upper()}] DA DUOC THEM VAO HE THONG!")
    print(f"[✓] Bay gio he thong se tu dong nhan dien duoc ca ban va chu nha moi!")
    print("=" * 68)
    return True

def main():
    print("=" * 68)
    print("     CONG CU NHAP DU LIEU MAT CHU NHA TU FILE ZIP (100 ANH)")
    print("=" * 68)

    # 1. Kiem tra tham so dong lenh (keo tha file)
    if len(sys.argv) > 1:
        zip_path = sys.argv[1]
        import_zip(zip_path)
        input("\nNhan phim Enter de ket thuc...")
        return

    # 2. Tu dong tim cac file dataset_*.zip trong Downloads hoac Desktop
    candidates = find_candidate_zips()
    if candidates:
        print("Phat hien cac file dataset_*.zip vua tai ve:")
        for idx, c in enumerate(candidates, 1):
            print(f"  [{idx}] {c}")
        print(f"  [0] Nhap duong dan file khac hoac keo tha file vao day")
        print("-" * 68)
        choice = input(f"Chon file can nhap [Mac dinh: 1]: ").strip()
        if not choice or choice == "1":
            import_zip(candidates[0])
            input("\nNhan phim Enter de ket thuc...")
            return
        elif choice.isdigit() and 1 <= int(choice) <= len(candidates):
            import_zip(candidates[int(choice) - 1])
            input("\nNhan phim Enter de ket thuc...")
            return

    # 3. Yeu cau nguoi dung nhap duong dan hoac keo tha file
    print("Huong dan:")
    print("  Keo tha file .zip nhan duoc tu Zalo vao cua so nay roi nhan Enter.")
    print("-" * 68)
    user_input = input("Duong dan file .zip: ").strip()
    if user_input:
        import_zip(user_input)
    else:
        print("[!] Chua nhap duong dan file.")
    input("\nNhan phim Enter de ket thuc...")

if __name__ == "__main__":
    main()
