$url = "http://192.168.50.95/api/path"

$body = @'
{
  "reset": true,
  "speed": 1800,
  "startPosition": { "x": 575, "y": 365 },
  "points": [
    { "x": 775, "y": 365, "penDown": true }
  ]
}
'@

Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json' -Body $body