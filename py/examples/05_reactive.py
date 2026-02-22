"""Reactive mode — auto-runs on input change, no submit button."""

from typing import Literal
import jsee

def calculator(
  num1: float = 0,
  operation: Literal['add', 'subtract', 'multiply', 'divide'] = 'add',
  num2: float = 0
) -> dict:
  if operation == 'add': return {'result': num1 + num2}
  elif operation == 'subtract': return {'result': num1 - num2}
  elif operation == 'multiply': return {'result': num1 * num2}
  elif operation == 'divide':
    return {'result': num1 / num2 if num2 != 0 else 'N/A'}

jsee.serve(calculator, reactive=True)
