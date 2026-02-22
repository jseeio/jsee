"""Output types — table, markdown, image via return type annotations."""

from typing import Annotated
import jsee

def report(query: str = 'hello') -> dict:
  """Generate a report with multiple output types"""
  rows = [
    {'word': w, 'length': len(w), 'upper': w.upper()}
    for w in query.split()
  ]
  md = '## Report for "{}"\n\n'.format(query)
  md += '- **Words**: {}\n'.format(len(rows))
  md += '- **Characters**: {}\n'.format(len(query))
  return {'summary': md, 'data': rows}

jsee.serve(
  report,
  title='Word Report',
  outputs={'summary': jsee.Markdown(), 'data': jsee.Table()},
)
