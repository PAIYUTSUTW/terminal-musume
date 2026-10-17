param(
    [string]$OutputDirectory = "$env:LOCALAPPDATA\TerminalMusumeDemo\captures",
    [int]$Frames = 1,
    [int]$Fps = 8,
    [string]$Prefix = 'terminal',
    [string]$TitlePattern = '*Terminal Musume - LIVE DEMO*',
    [ValidateSet('png','jpg')][string]$Format = 'png',
    [switch]$List,
    [switch]$Close,
    [switch]$CloseDebug
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class MusumeCapture {
    public delegate bool Callback(IntPtr h, IntPtr p);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int height, bool repaint);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[MusumeCapture]::SetProcessDPIAware() | Out-Null
$script:windows = @()
$callback = [MusumeCapture+Callback] {
    param($windowHandle, $parameter)
    if ([MusumeCapture]::IsWindowVisible($windowHandle)) {
        $class = New-Object System.Text.StringBuilder 256
        [MusumeCapture]::GetClassName($windowHandle, $class, $class.Capacity) | Out-Null
        if ($class.ToString() -eq 'CASCADIA_HOSTING_WINDOW_CLASS') {
            $title = New-Object System.Text.StringBuilder 512
            [MusumeCapture]::GetWindowText($windowHandle, $title, $title.Capacity) | Out-Null
            $script:windows += [PSCustomObject]@{ Handle = $windowHandle.ToInt64(); Title = $title.ToString() }
        }
    }
    return $true
}
[MusumeCapture]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
if ($List) { $script:windows | ConvertTo-Json -Compress; exit 0 }
if ($CloseDebug) {
    foreach ($window in @($script:windows | Where-Object { $_.Title -eq 'MusumeDebug' })) {
        [MusumeCapture]::PostMessage([IntPtr]$window.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    }
    exit 0
}
$selected = @($script:windows | Where-Object { $_.Title -like $TitlePattern })
if ($selected.Count -ne 1) { throw "Expected one live demo window. Found $($selected.Count)." }
$demoWindow = [IntPtr]$selected[0].Handle
if ($Close) { [MusumeCapture]::PostMessage($demoWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; exit 0 }
[MusumeCapture]::ShowWindow($demoWindow, 9) | Out-Null
[MusumeCapture]::MoveWindow($demoWindow, 70, 65, 1180, 800, $true) | Out-Null
[MusumeCapture]::SetWindowPos($demoWindow, [IntPtr](-1), 70, 65, 1180, 800, 0x0040) | Out-Null
[MusumeCapture]::SetForegroundWindow($demoWindow) | Out-Null
Start-Sleep -Milliseconds 800
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$rect = New-Object MusumeCapture+RECT
[MusumeCapture]::GetWindowRect($demoWindow, [ref]$rect) | Out-Null
# Exclude the invisible resize border and rounded outer corners.
$rect.Left += 8
$rect.Top += 8
$width = $rect.Right - $rect.Left - 8
$height = $rect.Bottom - $rect.Top - 8
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$captureMethod = 'CopyFromScreen'
try {
    for ($frame = 0; $frame -lt $Frames; $frame++) {
        $target = $frame * 1000.0 / $Fps
        $remaining = $target - $watch.Elapsed.TotalMilliseconds
        if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int]$remaining) }
        try {
            $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $width, $height), [System.Drawing.CopyPixelOperation]::SourceCopy)
        } catch {
            $dc = $graphics.GetHdc()
            try { $printed = [MusumeCapture]::PrintWindow($demoWindow, $dc, 2) } finally { $graphics.ReleaseHdc($dc) }
            if (-not $printed) { throw 'Windows window capture is unavailable on this desktop.' }
            $captureMethod = 'PrintWindow'
        }
        $filename = Join-Path $OutputDirectory ('{0}-{1:D5}.{2}' -f $Prefix, $frame, $Format)
        $imageFormat = if ($Format -eq 'jpg') { [System.Drawing.Imaging.ImageFormat]::Jpeg } else { [System.Drawing.Imaging.ImageFormat]::Png }
        $bitmap.Save($filename, $imageFormat)
    }
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
    [MusumeCapture]::SetWindowPos($demoWindow, [IntPtr](-2), 0, 0, 0, 0, 0x0013) | Out-Null
}
[PSCustomObject]@{ Handle = $demoWindow.ToInt64(); Width = $width; Height = $height; Frames = $Frames; Fps = $Fps; Method = $captureMethod; ElapsedMs = [int]$watch.Elapsed.TotalMilliseconds; OutputDirectory = $OutputDirectory } | ConvertTo-Json -Compress
