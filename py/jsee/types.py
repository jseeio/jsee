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


# ---------------------------------------------------------------------------
# Output descriptors — used in return type annotations or outputs kwarg
# ---------------------------------------------------------------------------

class Markdown:
  """Output rendered as Markdown (headings, tables, links, etc.)."""
  pass


class Html:
  """Output rendered as raw HTML."""
  pass


class Code:
  """Output rendered in a <pre> code block."""
  pass


class Image:
  """Output rendered as an <img> tag (expects URL or data URI)."""
  pass


class Table:
  """Output rendered as a sortable, scrollable table."""
  pass


class Svg:
  """Output rendered as inline SVG."""
  pass


class File:
  """Output rendered as a download button (not displayed)."""
  def __init__(self, filename=None):
    self.filename = filename


# Map descriptor class → JSEE output type string
OUTPUT_TYPE_MAP = {
  Markdown: 'markdown',
  Html: 'html',
  Code: 'code',
  Image: 'image',
  Table: 'table',
  Svg: 'svg',
  File: 'file',
}
