$ErrorActionPreference = 'Stop'
$port = 8000
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-ContentType([string]$path) {
  switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
    '.html' { 'text/html; charset=utf-8' }
    '.htm'  { 'text/html; charset=utf-8' }
    '.css'  { 'text/css; charset=utf-8' }
    '.js'   { 'application/javascript; charset=utf-8' }
    '.json' { 'application/json; charset=utf-8' }
    '.png'  { 'image/png' }
    '.jpg'  { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    '.gif'  { 'image/gif' }
    '.svg'  { 'image/svg+xml' }
    '.ico'  { 'image/x-icon' }
    '.webp' { 'image/webp' }
    '.woff' { 'font/woff' }
    '.woff2'{ 'font/woff2' }
    default { 'application/octet-stream' }
  }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
try {
  $listener.Start()
} catch {
  Write-Host "Port $port is already in use. Trying 8001..." -ForegroundColor Yellow
  $port = 8001
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
  $listener.Start()
}

$url = "http://localhost:$port/"
Write-Host "Whatcom Maritime Atlas local preview" -ForegroundColor Cyan
Write-Host "Serving: $root"
Write-Host "Open:    $url"
Write-Host "Press Ctrl+C in this window to stop the preview server." -ForegroundColor Yellow
Start-Process $url

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 8192, $true)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) { $client.Close(); continue }

      while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq '') { break }
      }

      $parts = $requestLine.Split(' ')
      $method = $parts[0]
      $target = if ($parts.Length -gt 1) { $parts[1] } else { '/' }
      $target = $target.Split('?')[0]
      $decoded = [System.Uri]::UnescapeDataString($target)
      if ($decoded -eq '/') { $decoded = '/index.html' }
      $relative = $decoded.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
      $rootFull = [System.IO.Path]::GetFullPath($root)

      $status = '200 OK'
      $body = $null
      $contentType = 'text/plain; charset=utf-8'

      if (-not $candidate.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        $status = '403 Forbidden'
        $body = [System.Text.Encoding]::UTF8.GetBytes('Forbidden')
      } elseif (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        $status = '404 Not Found'
        $body = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
      } else {
        $body = [System.IO.File]::ReadAllBytes($candidate)
        $contentType = Get-ContentType $candidate
      }

      $headers = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store, no-cache, must-revalidate`r`nPragma: no-cache`r`nAccess-Control-Allow-Origin: *`r`nConnection: close`r`n`r`n"
      $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      if ($method -ne 'HEAD') { $stream.Write($body, 0, $body.Length) }
      $stream.Flush()
    } catch {
      Write-Host "Request error: $($_.Exception.Message)" -ForegroundColor DarkYellow
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
