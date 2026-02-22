"""Calculator with Literal type for radio/select and examples."""

from typing import Literal
import jsee

def calculator(
  num1: float,
  operation: Literal['add', 'subtract', 'multiply', 'divide'],
  num2: float
) -> dict:
  """A simple calculator"""
  if operation == 'add': return {'result': num1 + num2}
  elif operation == 'subtract': return {'result': num1 - num2}
  elif operation == 'multiply': return {'result': num1 * num2}
  elif operation == 'divide':
    if num2 == 0: return {'error': 'Cannot divide by zero!'}
    return {'result': num1 / num2}

jsee.serve(
  calculator,
  title='Toy Calculator',
  description='A sample toy calculator',
  examples=[
    {'num1': 45, 'operation': 'add', 'num2': 3},
    {'num1': 3.14, 'operation': 'divide', 'num2': 2},
    {'num1': 144, 'operation': 'multiply', 'num2': 2.5},
  ]
)
