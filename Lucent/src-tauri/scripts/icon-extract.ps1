param([string]$InFile, [string]$OutFile, [int]$Size = 128)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class IconGrab {
  [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int cx; public int cy; }

  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItemImageFactory {
    [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid,
    [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] phicon, uint[] piconid, uint nIcons, uint flags);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);

  static string ToPng(Bitmap b) {
    using (MemoryStream ms = new MemoryStream()) {
      b.Save(ms, ImageFormat.Png);
      return Convert.ToBase64String(ms.ToArray());
    }
  }

  static Bitmap WithAlpha(IntPtr hbm) {
    using (Bitmap tmp = Image.FromHbitmap(hbm)) {
      if (Image.GetPixelFormatSize(tmp.PixelFormat) < 32) return new Bitmap(tmp);
      BitmapData d = tmp.LockBits(new Rectangle(0, 0, tmp.Width, tmp.Height), ImageLockMode.ReadOnly, tmp.PixelFormat);
      try {
        using (Bitmap a = new Bitmap(d.Width, d.Height, d.Stride, PixelFormat.Format32bppArgb, d.Scan0)) {
          return new Bitmap(a);
        }
      } finally { tmp.UnlockBits(d); }
    }
  }

  public static string FromShell(string parsingName, int size) {
    Guid g = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
    IShellItemImageFactory f;
    SHCreateItemFromParsingName(parsingName, IntPtr.Zero, ref g, out f);
    SIZE sz; sz.cx = size; sz.cy = size;
    IntPtr hbm;
    int hr = f.GetImage(sz, 0x4, out hbm);
    if (hr != 0 || hbm == IntPtr.Zero) return null;
    try { using (Bitmap b = WithAlpha(hbm)) return ToPng(b); }
    finally { DeleteObject(hbm); Marshal.ReleaseComObject(f); }
  }

  public static string Thumb(string parsingName, int size) {
    Guid g = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
    IShellItemImageFactory f;
    SHCreateItemFromParsingName(parsingName, IntPtr.Zero, ref g, out f);
    SIZE sz; sz.cx = size; sz.cy = size;
    IntPtr hbm;
    int hr = f.GetImage(sz, 0x8, out hbm);
    if (hr != 0 || hbm == IntPtr.Zero) return null;
    try { using (Bitmap b = WithAlpha(hbm)) using (Bitmap sq = Square(b, size)) return ToPng(sq); }
    finally { DeleteObject(hbm); Marshal.ReleaseComObject(f); }
  }

  static Bitmap Square(Bitmap b, int size) {
    Bitmap sq = new Bitmap(size, size, PixelFormat.Format32bppArgb);
    double k = Math.Min(1.0, (double)size / Math.Max(b.Width, b.Height));
    int w = (int)Math.Round(b.Width * k), h = (int)Math.Round(b.Height * k);
    using (Graphics g = Graphics.FromImage(sq)) {
      g.Clear(Color.Transparent);
      g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
      g.DrawImage(b, (size - w) / 2, (size - h) / 2, w, h);
    }
    return sq;
  }

  public static string FromIconFile(string file, int index, int size) {
    IntPtr[] h = new IntPtr[1]; uint[] id = new uint[1];
    uint n = PrivateExtractIcons(file, index, size, size, h, id, 1, 0);
    if (n == 0 || n == 0xFFFFFFFF || h[0] == IntPtr.Zero) return null;
    try {
      using (Icon ic = Icon.FromHandle(h[0]))
      using (Bitmap b = ic.ToBitmap())
      using (Bitmap c = new Bitmap(b)) return ToPng(c);
    } finally { DestroyIcon(h[0]); }
  }
}
'@

$items = Get-Content -LiteralPath $InFile -Raw -Encoding UTF8 | ConvertFrom-Json
$sh = New-Object -ComObject WScript.Shell
$out = @{}
$thumbExt = @('.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.gif', '.bmp', '.webp', '.tif', '.tiff', '.heic', '.heif', '.avif', '.ico',
  '.mp4', '.m4v', '.mov', '.mkv', '.avi', '.wmv', '.webm', '.flv', '.mpg', '.mpeg', '.3gp', '.ts')
foreach ($it in @($items)) {
  $png = $null
  try {
    $p = [string]$it.path
    if ($p.EndsWith('.lnk', [StringComparison]::OrdinalIgnoreCase)) {
      $lnk = $sh.CreateShortcut($p)
      $loc = ([string]$lnk.IconLocation).Trim()
      $target = [string]$lnk.TargetPath
      if ($loc -and $loc -ne ',0') {
        $idx = 0
        $file = $loc
        $c = $loc.LastIndexOf(',')
        if ($c -ge 0) { $file = $loc.Substring(0, $c); [void][int]::TryParse($loc.Substring($c + 1), [ref]$idx) }
        $file = [Environment]::ExpandEnvironmentVariables($file.Trim('"'))
        if ($file -and (Test-Path -LiteralPath $file -PathType Leaf)) { $png = [IconGrab]::FromIconFile($file, $idx, $Size) }
      }
      if (-not $png -and $target -and (Test-Path -LiteralPath $target)) { $png = [IconGrab]::FromShell($target, $Size) }
    }
    if (-not $png) {
      $ext = [IO.Path]::GetExtension($p).ToLowerInvariant()
      if ($thumbExt -contains $ext) { $png = [IconGrab]::Thumb($p, $Size) }
    }
    if (-not $png) { $png = [IconGrab]::FromShell($p, $Size) }
  } catch { }
  if ($png) { $out[[string]$it.id] = $png }
}
[IO.File]::WriteAllText($OutFile, ($out | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
