"""Annotation descriptors for typing.Annotated metadata.

Usage:
    from typing import Annotated
    import jsee

    def predict(
        text: str,
        temperature: Annotated[float, jsee.Slider(0, 1, 0.01)] = 0.7,
        mode: Annotated[str, jsee.Radio(['fast', 'slow'])] = 'fast'
    ) -> str:
        ...
"""


class Slider:
  """Number input rendered as a slider with min/max/step."""
  def __init__(self, min=None, max=None, step=None):
    self.min = min
    self.max = max
    self.step = step


class Text:
  """String input rendered as a multi-line textarea."""
  pass


class Radio:
  """String input rendered as radio buttons."""
  def __init__(self, options):
    self.options = list(options)


class Select:
  """String input rendered as a dropdown select."""
  def __init__(self, options):
    self.options = list(options)


class MultiSelect:
  """Multi-select input rendered as a checkbox group."""
  def __init__(self, options):
    self.options = list(options)


class Range:
  """Dual-handle range slider returning [min, max]."""
  def __init__(self, min=None, max=None, step=None):
    self.min = min
    self.max = max
    self.step = step


class Color:
  """String input rendered as a color picker."""
  pass
