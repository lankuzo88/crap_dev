"""
labo_gui.py
───────────
Giao diện đồ họa cho labo_cleaner.py
Chạy: python labo_gui.py

Yêu cầu: pip install pdfplumber openpyxl
labo_cleaner.py phải nằm cùng thư mục.
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import threading
import os
import sys
import subprocess
from datetime import datetime


# ═══════════════════════════════════════════════════════════════════════════════
# MÀU SẮC & STYLE
# ═══════════════════════════════════════════════════════════════════════════════

BG          = "#F0F4F8"
PANEL        = "#FFFFFF"
ACCENT       = "#1F4E79"
ACCENT2      = "#2E75B6"
SUCCESS      = "#375623"
WARNING      = "#C55A11"
ERROR_CLR    = "#C00000"
TEXT         = "#1A1A2E"
TEXT_LIGHT   = "#6B7280"
BORDER       = "#D1D5DB"
ROW_ALT      = "#F9FAFB"

FONT_TITLE  = ("Segoe UI", 16, "bold")
FONT_HDR    = ("Segoe UI", 10, "bold")
FONT_BODY   = ("Segoe UI", 9)
FONT_SMALL  = ("Segoe UI", 8)
FONT_MONO   = ("Consolas", 9)


# ═══════════════════════════════════════════════════════════════════════════════
# APP
# ═══════════════════════════════════════════════════════════════════════════════

class LaboCleanerApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Labo Cleaner — Làm sạch dữ liệu nha khoa")
        self.root.geometry("720x600")
        self.root.minsize(640, 520)
        self.root.configure(bg=BG)

        # Optional icon — silently skip if missing or corrupt
        try:
            self.root.iconbitmap("labo_icon.ico")
        except Exception:
            pass

        self.input_path   = tk.StringVar()
        self.output_path = tk.StringVar()
        self.is_running  = False

        self._build_ui()
        self._center_window()

    # ── Build UI ──────────────────────────────────────────────────────────────

    def _build_ui(self):
        # Title bar
        title_bar = tk.Frame(self.root, bg=ACCENT, height=56)
        title_bar.pack(fill="x")
        title_bar.pack_propagate(False)

        tk.Label(
            title_bar,
            text="Labo Cleaner",
            font=FONT_TITLE,
            bg=ACCENT, fg="white",
            padx=20,
        ).pack(side="left", pady=10)

        tk.Label(
            title_bar,
            text="Làm sạch Excel DentalLab → Excel chuẩn",
            font=FONT_SMALL,
            bg=ACCENT, fg="#A8C4E0",
            padx=4,
        ).pack(side="left", pady=10)

        # Body
        body = tk.Frame(self.root, bg=BG, padx=20, pady=16)
        body.pack(fill="both", expand=True)

        # Panel chọn file
        file_panel = self._card(body, "Chọn file")

        # Input
        self._file_row(
            file_panel,
            label="File Excel đầu vào:",
            var=self.input_path,
            btn_text="Chọn...",
            cmd=self._browse_input,
            row=0,
        )

        # Output
        self._file_row(
            file_panel,
            label="File Excel xuất ra:",
            var=self.output_path,
            btn_text="Lưu về...",
            cmd=self._browse_output,
            row=1,
        )

        # Hint
        tk.Label(
            file_panel,
            text="De trong → tu dong luu cung thu muc voi file Excel dau vao",
            font=FONT_SMALL,
            bg=PANEL, fg=TEXT_LIGHT,
        ).grid(row=2, column=1, sticky="w", padx=4, pady=(0, 8))

        # Buttons row
        btn_row = tk.Frame(body, bg=BG)
        btn_row.pack(fill="x", pady=(0, 12))

        self.btn_run = tk.Button(
            btn_row,
            text="Bat dau xu ly",
            font=FONT_HDR,
            bg=SUCCESS, fg="white",
            activebackground="#2D6A1F",
            activeforeground="white",
            relief="flat",
            padx=28, pady=10,
            cursor="hand2",
            command=self._run,
        )
        self.btn_run.pack(side="left")

        self.btn_open = tk.Button(
            btn_row,
            text="Mo file ket qua",
            font=FONT_BODY,
            bg=ACCENT2, fg="white",
            activebackground="#1E5799",
            activeforeground="white",
            relief="flat",
            padx=16, pady=10,
            cursor="hand2",
            command=self._open_output,
            state="disabled",
        )
        self.btn_open.pack(side="left", padx=(10, 0))

        self.btn_clear = tk.Button(
            btn_row,
            text="Xoa log",
            font=FONT_BODY,
            bg="#6B7280", fg="white",
            activebackground="#4B5563",
            activeforeground="white",
            relief="flat",
            padx=16, pady=10,
            cursor="hand2",
            command=self._clear_log,
        )
        self.btn_clear.pack(side="right")

        # Progress bar
        progress_frame = tk.Frame(body, bg=BG)
        progress_frame.pack(fill="x", pady=(0, 8))

        self.progress_label = tk.Label(
            progress_frame,
            text="San sang",
            font=FONT_SMALL,
            bg=BG, fg=TEXT_LIGHT,
        )
        self.progress_label.pack(anchor="w")

        style = ttk.Style()
        style.theme_use("default")
        style.configure(
            "custom.Horizontal.TProgressbar",
            troughcolor=BORDER,
            background=ACCENT2,
            thickness=8,
        )

        self.progress = ttk.Progressbar(
            progress_frame,
            style="custom.Horizontal.TProgressbar",
            mode="indeterminate",
            length=680,
        )
        self.progress.pack(fill="x", pady=(2, 0))

        # Log panel
        log_panel = self._card(body, "Nhat ky xu ly", expand=True)

        log_inner = tk.Frame(log_panel, bg=PANEL)
        log_inner.grid(row=1, column=0, columnspan=3, sticky="nsew", padx=8, pady=(0, 8))
        log_panel.rowconfigure(1, weight=1)
        log_panel.columnconfigure(0, weight=1)

        self.log_text = tk.Text(
            log_inner,
            font=FONT_MONO,
            bg="#0D1117",
            fg="#E6EDF3",
            insertbackground="white",
            relief="flat",
            wrap="word",
            state="disabled",
            height=10,
        )
        scrollbar = ttk.Scrollbar(log_inner, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.log_text.pack(fill="both", expand=True)

        # Color tags for log
        self.log_text.tag_configure("info",    foreground="#58A6FF")
        self.log_text.tag_configure("success", foreground="#3FB950")
        self.log_text.tag_configure("warning", foreground="#D29922")
        self.log_text.tag_configure("error",   foreground="#F85149")
        self.log_text.tag_configure("dim",     foreground="#8B949E")
        self.log_text.tag_configure("bold",    foreground="#E6EDF3",
                                    font=("Consolas", 9, "bold"))

        self._log("Chuong trinh san sang. Chon file Excel de bat dau.", "dim")

    def _card(self, parent, title: str, expand: bool = False) -> tk.Frame:
        """Tạo panel card với tiêu đề."""
        outer = tk.Frame(parent, bg=BORDER)
        outer.pack(fill="both" if expand else "x", expand=expand, pady=(0, 12))

        inner = tk.Frame(outer, bg=PANEL, padx=12, pady=10)
        inner.pack(fill="both", expand=True, padx=1, pady=1)

        tk.Label(
            inner,
            text=title,
            font=FONT_HDR,
            bg=PANEL, fg=ACCENT,
        ).grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 8))

        return inner

    def _file_row(self, parent, label: str, var: tk.StringVar,
                  btn_text: str, cmd, row: int):
        """Một hàng chọn file gồm label + entry + button."""
        tk.Label(
            parent,
            text=label,
            font=FONT_BODY,
            bg=PANEL, fg=TEXT,
            width=18, anchor="e",
        ).grid(row=row + 1, column=0, padx=(0, 8), pady=4, sticky="e")

        entry = tk.Entry(
            parent,
            textvariable=var,
            font=FONT_MONO,
            bg=ROW_ALT, fg=TEXT,
            relief="flat",
            highlightthickness=1,
            highlightbackground=BORDER,
            highlightcolor=ACCENT2,
        )
        entry.grid(row=row + 1, column=1, sticky="ew", pady=4, ipady=5)
        parent.columnconfigure(1, weight=1)

        tk.Button(
            parent,
            text=btn_text,
            font=FONT_SMALL,
            bg=ACCENT, fg="white",
            activebackground=ACCENT2,
            activeforeground="white",
            relief="flat",
            padx=12, pady=4,
            cursor="hand2",
            command=cmd,
        ).grid(row=row + 1, column=2, padx=(8, 0), pady=4)

    # ── File browsing ────────────────────────────────────────────────────────

    def _browse_input(self):
        path = filedialog.askopenfilename(
            title="Chon file Excel tu DentalLab",
            filetypes=[("Excel files", "*.xls *.xlsx"), ("Tat ca", "*.*")],
        )
        if path:
            self.input_path.set(path)
            # Auto-fill output
            if not self.output_path.get():
                base = os.path.splitext(path)[0]
                self.output_path.set(base + "_cleaned.xlsx")
            self._log(f"Da chon input: {os.path.basename(path)}", "info")

    def _browse_output(self):
        init_dir  = os.path.dirname(self.input_path.get()) if self.input_path.get() else "/"
        init_file = os.path.basename(self.output_path.get()) or "output_cleaned.xlsx"
        path = filedialog.asksaveasfilename(
            title="Luu file Excel ket qua",
            initialdir=init_dir,
            initialfile=init_file,
            defaultextension=".xlsx",
            filetypes=[("Excel files", "*.xlsx"), ("Tat ca", "*.*")],
        )
        if path:
            self.output_path.set(path)
            self._log(f"Da chon output: {os.path.basename(path)}", "info")

    # ── Run processing ───────────────────────────────────────────────────────

    def _run(self):
        if self.is_running:
            return

        inp = self.input_path.get().strip()
        if not inp:
            # FIX: was "PDF" — corrected to "Excel"
            messagebox.showwarning("Thieu file", "Vui long chon file Excel dau vao.")
            return
        if not os.path.exists(inp):
            messagebox.showerror("Khong tim thay",
                                f"File khong ton tai:\n{inp}")
            return

        out = self.output_path.get().strip()
        if not out:
            out = os.path.splitext(inp)[0] + "_cleaned.xlsx"
            self.output_path.set(out)

        # Check file extension
        ext = os.path.splitext(inp)[1].lower()
        if ext not in (".xls", ".xlsx"):
            messagebox.showwarning("Sai dinh dang",
                                   "Vui long chon file .xls hoac .xlsx")
            return

        # Check labo_cleaner.py exists
        cleaner_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "labo_cleaner.py",
        )
        if not os.path.exists(cleaner_path):
            messagebox.showerror(
                "Thieu file",
                f"Khong tim thay labo_cleaner.py\n"
                f"Can dat cung thu muc voi labo_gui.py",
            )
            return

        self.is_running = True
        self.btn_run.config(state="disabled", text="Dang xu ly...")
        self.btn_open.config(state="disabled")
        self.progress.start(12)
        self.progress_label.config(text="Dang xu ly...", fg=ACCENT2)

        self._log(f"\n{'─' * 50}", "dim")
        self._log(f"[{datetime.now().strftime('%H:%M:%S')}] Bat dau xu ly", "bold")
        self._log(f"  Input : {inp}", "dim")
        self._log(f"  Output: {out}", "dim")

        thread = threading.Thread(
            target=self._worker,
            args=(inp, out, cleaner_path),
            daemon=True,
        )
        thread.start()

    def _worker(self, inp: str, out: str, cleaner_path: str):
        """Chạy labo_cleaner.py trong thread riêng — kết quả gửi về main thread."""
        try:
            env = os.environ.copy()
            env["PYTHONIOENCODING"] = "utf-8"
            result = subprocess.run(
                [sys.executable, cleaner_path, inp, out],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
            )
            # Marshal result to main thread via after()
            self.root.after(
                0,
                self._on_done,
                result.returncode,
                result.stdout.strip(),
                result.stderr.strip(),
                out,
            )
        except Exception as e:
            self.root.after(0, self._on_error, str(e))

    def _on_done(self, returncode: int, stdout: str, stderr: str, out: str):
        self.progress.stop()
        self.is_running = False
        self.btn_run.config(state="normal", text="Bat dau xu ly")

        # Process stdout — tag by content
        if stdout:
            for line in stdout.split("\n"):
                if not line.strip():
                    continue
                if "OK" in line or "DONE" in line or "Hoan thanh" in line:
                    self._log(line, "success")
                elif "Error" in line or "LOI" in line or "that bai" in line:
                    self._log(line, "error")
                elif "Sheet" in line or "Trang" in line:
                    self._log(line, "info")
                else:
                    self._log(line, "dim")

        # Process stderr — warn user
        if stderr:
            for line in stderr.split("\n"):
                if line.strip():
                    self._log(f"  Canh bao: {line}", "warning")

        if returncode == 0 and os.path.exists(out):
            size_kb = os.path.getsize(out) / 1024
            self._log(
                f"\nHoan thanh — {os.path.basename(out)} ({size_kb:.1f} KB)",
                "success",
            )
            self.progress_label.config(text="Hoan thanh!", fg=SUCCESS)
            self.btn_open.config(state="normal")
            messagebox.showinfo(
                "Xong!",
                f"Da xu ly thanh cong!\n\n"
                f"File ket qua:\n{out}\n"
                f"Kich thuoc: {size_kb:.1f} KB",
            )
        else:
            self._log(f"\nXu ly that bai (code={returncode})", "error")
            self.progress_label.config(text="That bai", fg=ERROR_CLR)
            messagebox.showerror(
                "Loi",
                f"Xu ly khong thanh cong.\nXem nhat ky de biet chi tiet.",
            )

    def _on_error(self, msg: str):
        self.progress.stop()
        self.is_running = False
        self.btn_run.config(state="normal", text="Bat dau xu ly")
        self._log(f"\nLoi: {msg}", "error")
        self.progress_label.config(text="Loi", fg=ERROR_CLR)
        messagebox.showerror("Loi he thong", msg)

    # ── Open output file ─────────────────────────────────────────────────────

    def _open_output(self):
        out = self.output_path.get().strip()
        if not out or not os.path.exists(out):
            messagebox.showwarning("Chua co file",
                                  "Chua co file ket qua de mo.")
            return
        try:
            if sys.platform == "win32":
                os.startfile(out)
            elif sys.platform == "darwin":
                subprocess.run(["open", out], check=True)
            else:
                subprocess.run(["xdg-open", out], check=True)
        except Exception as e:
            messagebox.showerror("Khong mo duoc", str(e))

    # ── Log (thread-safe via main-thread only) ───────────────────────────────

    def _log(self, msg: str, tag: str = ""):
        """Thread-safe log: always called from main thread via root.after()."""
        self.log_text.config(state="normal")
        self.log_text.insert("end", msg + "\n", tag)
        self.log_text.see("end")
        self.log_text.config(state="disabled")

    def _clear_log(self):
        self.log_text.config(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.config(state="disabled")
        self._log("Log da xoa.", "dim")

    # ── Center window ─────────────────────────────────────────────────────────

    def _center_window(self):
        self.root.update_idletasks()
        w = self.root.winfo_width()
        h = self.root.winfo_height()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = (sw - w) // 2
        y = (sh - h) // 2
        self.root.geometry(f"{w}x{h}+{x}+{y}")


# ═══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    root = tk.Tk()
    app = LaboCleanerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
