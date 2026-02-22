"""Custom schema — generate, modify, then serve."""

import jsee
from typing import Annotated

def predict(
  text: str,
  temperature: Annotated[float, jsee.Slider(0, 2, 0.1)] = 0.7
) -> str:
  """Text prediction demo"""
  return text.upper() * int(1 + temperature)

schema = jsee.generate_schema(predict)
# Customize: add sidebar layout, dark theme
schema['design'] = {'layout': 'sidebar', 'theme': 'dark'}
jsee.serve(schema)
