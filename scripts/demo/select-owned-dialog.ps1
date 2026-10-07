param(
  [Parameter(Mandatory = $true)][int]$OwnerProcessId,
  [Parameter(Mandatory = $true)][string]$OwnedProfile,
  [Parameter(Mandatory = $true)][string]$Selection
)
$ErrorActionPreference = 'Stop'
$expectedProfile = [IO.Path]::GetFullPath($OwnedProfile).TrimEnd('\', '/')
function Get-OwnedProcess {
  $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$OwnerProcessId"
  if (-not $candidate) { throw 'Owned demo process no longer exists.' }
  $argument = [regex]::Match($candidate.CommandLine, '(?:^|\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\s"]+))(?=\s|$)')
  $profile = @($argument.Groups[1].Value, $argument.Groups[2].Value, $argument.Groups[3].Value) | Where-Object { $_ }
  if (-not $argument.Success -or [IO.Path]::GetFullPath($profile).TrimEnd('\', '/') -ne $expectedProfile) {
    throw 'Refusing to automate a process outside the exact owned demo profile.'
  }
  return $candidate
}
$owner = Get-OwnedProcess
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $OwnerProcessId)
$deadline = [DateTime]::UtcNow.AddSeconds(25)
$dialog = $null
while ([DateTime]::UtcNow -lt $deadline) {
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
  foreach ($window in $windows) {
    if ($window.Current.ClassName -eq '#32770') { $dialog = $window; break }
    $dialog = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')))
    if ($dialog) { break }
  }
  if ($dialog) { break }
  Start-Sleep -Milliseconds 150
}
if (-not $dialog) { throw 'No native picker belonging to the owned Electron process appeared.' }
$dialogName = $dialog.Current.Name
if ($dialogName -notin @('Select Batch File (URL List)', 'Select Download Directory')) {
  throw "Refusing to automate an unexpected dialog: $dialogName"
}
function Assert-OwnedDialog {
  $currentOwner = Get-OwnedProcess
  if ($currentOwner.CreationDate -ne $owner.CreationDate -or $dialog.Current.ProcessId -ne $OwnerProcessId -or $dialog.Current.ClassName -ne '#32770' -or $dialog.Current.Name -ne $dialogName) {
    throw 'Owned process or native picker identity changed.'
  }
}
$edits = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Edit')))
$fileName = $null
foreach ($edit in $edits) {
  if ($edit.Current.AutomationId -eq '1148' -or $edit.Current.AutomationId -eq '1152') { $fileName = $edit; break }
}
if (-not $fileName) { throw 'Native picker filename/path edit was not found.' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OwnedPickerNative {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wparam, string lparam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
}
'@
$editHandle = [IntPtr]$fileName.Current.NativeWindowHandle
if ($editHandle -eq [IntPtr]::Zero) { throw 'Owned native filename edit has no window handle.' }
$nativePath = $Selection.Replace('/', '\')
$result = [IntPtr]::Zero
Assert-OwnedDialog
if ([OwnedPickerNative]::SendMessageTimeout($editHandle, 0x000C, [IntPtr]::Zero, $nativePath, 2, 2000, [ref]$result) -eq [IntPtr]::Zero) { throw 'Owned filename edit did not respond.' }
$buttons = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Button')))
$open = $null
foreach ($button in $buttons) {
  if ($button.Current.AutomationId -eq '1') { $open = $button; break }
}
if (-not $open) { throw 'Native picker confirmation button was not found.' }
$openHandle = [IntPtr]$open.Current.NativeWindowHandle
if ($openHandle -eq [IntPtr]::Zero) { throw 'Owned native confirmation button has no window handle.' }
Assert-OwnedDialog
if (-not [OwnedPickerNative]::PostMessage($openHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Owned native confirmation message could not be posted.' }
[pscustomobject]@{ ownerProcessId = $OwnerProcessId; dialog = $dialogName; selection = $nativePath; action = 'Owned native bounded WM_SETTEXT + posted BM_CLICK' } | ConvertTo-Json
