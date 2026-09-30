import unittest
from catalog_description import readable_description

class DescriptionTests(unittest.TestCase):
    def test_readable_lines_and_inline_text(self):
        source='A <strong>white gold</strong> ring.<div data-zone-id="0">Metal: 925 Sterling Silver</div><div>Stone: moissanite</div>'
        self.assertEqual(readable_description(source),'A white gold ring.\nMetal: 925 Sterling Silver\nStone: moissanite')

    def test_lists_entities_and_script_text(self):
        self.assertEqual(readable_description('<p>Gold &amp; silver</p><ul><li>Small</li><li>Large</li></ul><script>bad()</script>'),'Gold & silver\n• Small\n• Large')

    def test_plain_text_remains_unchanged(self):
        source='Price < $100\nEngrave <NAME> & date'
        self.assertEqual(readable_description(source),source)

if __name__=='__main__':unittest.main()
