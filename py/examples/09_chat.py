"""Chat interface — fn(message, history) → response string."""

import jsee

def chat(message: str, history: list = []) -> str:
  """Echo chatbot"""
  if not message.strip():
    return 'Please type a message.'
  return 'You said: ' + message

jsee.serve(chat, chat=True, title='Echo Chat')
