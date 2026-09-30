"""Readable native Medusa descriptions; the original markup is archived separately."""
import re
from bs4 import BeautifulSoup

def readable_description(value):
    if not value or not re.search(r'</?(?:div|p|br|span|strong|em|b|i|ul|ol|li|table|tr|td|th|h[1-6]|a|img|section|blockquote)\b', value, re.I):
        return value
    soup = BeautifulSoup(value, 'html.parser')
    for node in soup(['script', 'style', 'noscript']):
        node.decompose()
    for node in soup.find_all('br'):
        node.replace_with('\n')
    for node in soup.find_all('img'):
        node.replace_with(node.get('alt', ''))
    for node in soup.find_all(['td', 'th']):
        node.insert_after(' | ')
    for node in soup.find_all('li'):
        node.insert_before('\n• ')
        node.insert_after('\n')
    for node in soup.find_all(['p', 'div', 'section', 'blockquote', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
        node.insert_before('\n')
        node.insert_after('\n')
    lines = [re.sub(r'[^\S\n]+', ' ', line).strip().rstrip('|').strip() for line in soup.get_text().splitlines()]
    return '\n'.join(line for line in lines if line)
