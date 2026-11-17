# Prints one slip image (PNG) to a named Windows printer, no dialog. Called by server.mjs.
# The page is sized to the slip: WidthMm wide (58 or 80), as tall as the image needs.
param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [Parameter(Mandatory = $true)][string]$File,
  [double]$WidthMm = 80
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$img = [System.Drawing.Image]::FromFile($File)
try {
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $Printer
  if (-not $doc.PrinterSettings.IsValid) { throw "Printer not found: $Printer" }
  $doc.DocumentName = 'Online Lotto slip'
  $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController  # no "Printing..." popup

  # Printer units are 1/100 inch.
  $w = [int][Math]::Round($WidthMm / 25.4 * 100)
  $h = [int][Math]::Ceiling($w * $img.Height / $img.Width)
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('Slip', $w, $h)
  $doc.OriginAtMargins = $false

  $doc.add_PrintPage({
    param($sender, $e)
    $e.Graphics.DrawImage($img, 0, 0, $w, $h)
    $e.HasMorePages = $false
  })
  $doc.Print()
} finally {
  $img.Dispose()
}
