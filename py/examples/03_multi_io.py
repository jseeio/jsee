"""Multiple inputs and outputs."""

from typing import Annotated
import jsee

def weather(
  name: str,
  is_morning: bool = True,
  temperature: Annotated[float, jsee.Slider(0, 100)] = 72
) -> dict:
  """Weather greeting"""
  salutation = 'Good morning' if is_morning else 'Good evening'
  celsius = round((temperature - 32) * 5 / 9, 2)
  return {
    'greeting': '{} {}. It is {} degrees today'.format(salutation, name, temperature),
    'celsius': celsius,
  }

jsee.serve(weather)
