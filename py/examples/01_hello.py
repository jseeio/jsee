"""Hello world — text in, text out."""

import jsee

def greet(name: str) -> str:
  """Say hello"""
  return 'Hello ' + name + '!'

jsee.serve(greet)
