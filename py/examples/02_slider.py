"""Slider input with Annotated type."""

from typing import Annotated
import jsee

def greet(name: str, intensity: Annotated[int, jsee.Slider(1, 10)] = 2) -> str:
  """Greeting with intensity"""
  return 'Hello, ' + name + '!' * intensity

jsee.serve(greet)
