"""File upload — function receives bytes, returns analysis."""

import jsee

def analyze(data: bytes) -> dict:
  """Analyze an uploaded file"""
  lines = data.decode('utf-8', errors='replace').splitlines()
  words = sum(len(line.split()) for line in lines)
  return {
    'lines': len(lines),
    'words': words,
    'characters': len(data),
    'preview': '\n'.join(lines[:5]),
  }

jsee.serve(analyze, title='File Analyzer')
