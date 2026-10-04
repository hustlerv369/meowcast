import { BrowserWindow, type WebContents } from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

// Fixed code only. User text travels over stdin JSON, never through shell interpolation.
export const selectionScript = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class NativeTarget {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
 [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx,dy; public uint mouseData,flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT keyboard; [FieldOffset(0)] public MOUSEINPUT mouse; }
 [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION data; }
 [DllImport("user32.dll")] public static extern uint SendInput(uint count, INPUT[] input, int size);
 public static bool Paste() {
  INPUT[] inputs=new INPUT[4]; ushort[] keys={0x11,0x56,0x56,0x11};
  for(int i=0;i<4;i++) { inputs[i].type=1; inputs[i].data.keyboard.key=keys[i]; inputs[i].data.keyboard.flags=(uint)(i<2?0:2); }
  return SendInput(4,inputs,Marshal.SizeOf(typeof(INPUT)))==4;
 }
}
"@
$stage='input'
try {
 $data=[Console]::In.ReadToEnd() | ConvertFrom-Json
 if($data.mode -eq 'insert') {
  $handle=[IntPtr][long]$data.hwnd
  [uint32]$targetPid=0
  [void][NativeTarget]::GetWindowThreadProcessId($handle,[ref]$targetPid)
  if($targetPid -ne $data.pid) { throw 'target' }
  if(-not [NativeTarget]::SetForegroundWindow($handle)) { throw 'focus' }
  Start-Sleep -Milliseconds 180
 }
 $stage='foreground'
 $hwnd=[NativeTarget]::GetForegroundWindow()
 [uint32]$ownerPid=0
 [void][NativeTarget]::GetWindowThreadProcessId($hwnd,[ref]$ownerPid)
 $stage='focused-element'
 $element=[System.Windows.Automation.AutomationElement]::FocusedElement
 $stage='password-or-process'
 if($null -eq $element -or $element.Current.IsPassword -or $element.Current.ProcessId -ne $ownerPid) { throw 'private' }
 $identity=($element.GetRuntimeId() -join ',')
 $stage='text-pattern'
 $pattern=$null
 if(-not $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$pattern)) { throw 'unsupported' }
 $stage='selection-ranges'
 $ranges=$pattern.GetSelection()
 if($ranges.Length -ne 1) { throw 'selection' }
 $stage='document-range'
 $documentRange=$pattern.DocumentRange
 $stage='clone-range'
 $prefix=$documentRange.Clone()
 $stage='move-endpoint'
 $prefix.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End,$ranges[0],[System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start)
 $stage='prefix-text'
 $rangeStart=$prefix.GetText(100001).Length
 if($rangeStart -gt 100000) { throw 'range' }
 $stage='selected-text'
 $selected=$ranges[0].GetText(100001)
 if([string]::IsNullOrWhiteSpace($selected) -or $selected.Length -gt 100000) { throw 'selection' }
 $stage='editable-pattern'
 $value=$null
 $editable=$element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$value) -and -not $value.Current.IsReadOnly
 if($data.mode -eq 'capture') {
  @{text=$selected; hwnd=$hwnd.ToInt64().ToString(); pid=$ownerPid; identity=$identity; editable=$editable; rangeStart=$rangeStart} | ConvertTo-Json -Compress
 } else {
  if($hwnd.ToInt64().ToString() -ne $data.hwnd -or $ownerPid -ne $data.pid -or $identity -ne $data.identity -or $rangeStart -ne $data.rangeStart -or $selected -cne $data.original -or -not $editable) { throw 'changed' }
  # Preserve all available formats; do not paste if an existing clipboard cannot be materialized.
  $before=[NativeTarget]::GetClipboardSequenceNumber()
  $old=[System.Windows.Forms.Clipboard]::GetDataObject()
  $snapshot=New-Object System.Windows.Forms.DataObject
  if($old) { foreach($format in $old.GetFormats($false)) { $snapshot.SetData($format,$false,$old.GetData($format,$false)) } }
  if([NativeTarget]::GetClipboardSequenceNumber() -ne $before) { throw 'clipboard' }
  $temporary=New-Object System.Windows.Forms.DataObject
  $temporary.SetText([string]$data.text)
  $temporary.SetData('ExcludeClipboardContentFromMonitorProcessing',[byte[]]@(1))
  [System.Windows.Forms.Clipboard]::SetDataObject($temporary,$true)
  $ours=[NativeTarget]::GetClipboardSequenceNumber()
  try {
   if([NativeTarget]::GetForegroundWindow() -ne $hwnd -or [NativeTarget]::GetClipboardSequenceNumber() -ne $ours) { throw 'focus' }
   $now=[System.Windows.Automation.AutomationElement]::FocusedElement
   if($now.Current.IsPassword -or $now.Current.ProcessId -ne $ownerPid -or ($now.GetRuntimeId() -join ',') -ne $identity) { throw 'field' }
   $currentPattern=$null
   $currentValue=$null
   if(-not $now.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$currentPattern) -or -not $now.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$currentValue) -or $currentValue.Current.IsReadOnly) { throw 'field' }
   $currentRanges=$currentPattern.GetSelection()
   if($currentRanges.Length -ne 1 -or $currentRanges[0].GetText(100001) -cne $data.original) { throw 'selection' }
   $currentPrefix=$currentPattern.DocumentRange.Clone()
   $currentPrefix.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End,$currentRanges[0],[System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start)
   if($currentPrefix.GetText(100001).Length -ne $data.rangeStart) { throw 'selection' }
   if([NativeTarget]::GetForegroundWindow() -ne $hwnd -or [NativeTarget]::GetClipboardSequenceNumber() -ne $ours) { throw 'focus' }
   if(-not [NativeTarget]::Paste()) { throw 'input' }
   Start-Sleep -Milliseconds 500
  } finally {
   if([NativeTarget]::GetClipboardSequenceNumber() -eq $ours) {
    if($old) { [System.Windows.Forms.Clipboard]::SetDataObject($snapshot,$true) } else { [System.Windows.Forms.Clipboard]::Clear() }
   }
  }
  '{"dispatched":true,"confirmed":false}'
 }
} catch { @{error="Selection unavailable ($stage; $($_.Exception.GetType().Name); $($_.Exception.HResult)). Copy the result instead."} | ConvertTo-Json -Compress }
`;

type Capture = {
    text: string;
    hwnd: string;
    pid: number;
    identity: string;
    rangeStart: number;
    editable: boolean;
    token: string;
    at: number;
};
export const runSelection = (data: unknown): Promise<Record<string, unknown>> => {
    return new Promise((resolve, reject) => {
        const child = spawn(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-Sta",
                "-EncodedCommand",
                Buffer.from(selectionScript, "utf16le").toString("base64"),
            ],
            { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
        );
        let output = "";
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error("Selection timed out. Copy the result instead."));
        }, 12000);
        child.stdout.on("data", (chunk) => {
            output += chunk.toString();

            if (output.length > 800000) {
                child.kill();
            }
        });
        child.stderr.resume();
        child.once("error", () => {
            clearTimeout(timer);
            reject(new Error("Windows selection helper unavailable."));
        });
        child.once("close", () => {
            clearTimeout(timer);

            try {
                const result = JSON.parse(output.replace(/^\uFEFF/, "").trim());

                if (result.error) {
                    reject(new Error(result.error));
                } else {
                    resolve(result);
                }
            } catch {
                reject(new Error("Selection unavailable. Copy the result instead."));
            }
        });
        child.stdin.on("error", () => undefined);
        child.stdin.end(JSON.stringify(data));
    });
};

export class NativeSelection {
    public shortcutStatus: { shortcut: string; available: boolean; error?: string } = {
        shortcut: "Control+Shift+Space",
        available: false,
    };
    private readonly captures = new Map<number, Capture>();
    private busy = false;
    private readonly observedSenders = new WeakSet<WebContents>();
    public latest(sender?: WebContents) {
        const value = this.captures.get(sender?.id ?? -1);

        if (!value || Date.now() - value.at >= 300000) {
            this.captures.delete(sender?.id ?? -1);
            return null;
        }

        return { text: value.text, token: value.token, editable: value.editable };
    }
    public async capture(sender?: WebContents, delay = true) {
        if (process.platform !== "win32" || !sender || this.busy) {
            throw new Error("Selection capture is available on Windows when no capture is running.");
        }

        if (!this.observedSenders.has(sender)) {
            this.observedSenders.add(sender);
            sender.once("destroyed", () => this.captures.delete(sender.id));
        }

        this.busy = true;
        this.captures.delete(sender.id);
        this.shortcutStatus.error = undefined;

        try {
            if (delay) {
                BrowserWindow.fromWebContents(sender)?.hide();
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }

            const value = await runSelection({ mode: "capture" });

            if (typeof value.text !== "string" || value.pid === process.pid) {
                throw new Error("Select text in another application first.");
            }

            this.captures.set(sender.id, { ...value, token: randomUUID(), at: Date.now() } as Capture);
            return this.latest(sender);
        } catch (error) {
            this.shortcutStatus.error =
                error instanceof Error ? error.message : "Selection unavailable. Copy text manually.";
            throw error;
        } finally {
            this.busy = false;
            const window = BrowserWindow.fromWebContents(sender);
            window?.show();
            window?.focus();
        }
    }
    public async insert(sender?: WebContents, token?: string, text?: string) {
        const capture = this.captures.get(sender?.id ?? -1);

        if (
            !capture ||
            capture.token !== token ||
            Date.now() - capture.at > 300000 ||
            !capture.editable ||
            typeof text !== "string" ||
            !text.length ||
            text.length > 100000 ||
            this.busy
        ) {
            throw new Error("Selection expired or cannot be edited. Copy the result instead.");
        }

        this.captures.delete(sender!.id); // one use, including failed attempts
        this.busy = true;
        BrowserWindow.fromWebContents(sender!)?.hide();

        try {
            return await runSelection({ mode: "insert", ...capture, original: capture.text, text });
        } catch (error) {
            const window = BrowserWindow.fromWebContents(sender!);
            window?.show();
            window?.focus();
            throw error;
        } finally {
            this.busy = false;
        }
    }
}
export const nativeSelection = new NativeSelection();
