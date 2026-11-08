"""What a LoRA's own header suggests for the prompt when Civitai gives no trigger words
(header_words.py): the maker's trigger phrase, else the tags most training pictures share."""
import json
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

import header_words  # noqa: E402

LORA_KEY = "lora_unet_input_blocks_4_1_proj_in.lora_down.weight"


def model_file(folder, name, keys, meta):
    header = {key: {"dtype": "F16", "shape": [4, 4], "data_offsets": [0, 0]} for key in keys}
    header["__metadata__"] = meta
    raw = json.dumps(header).encode("utf-8")
    path = os.path.join(folder, name)
    Path(path).write_bytes(struct.pack("<Q", len(raw)) + raw + b"\0" * 8)
    return path


class WordTests(unittest.TestCase):
    def test_the_makers_phrase_comes_first(self):
        meta = {"modelspec.trigger_phrase": " glowstyle, neon rim ,", "ss_tag_frequency": json.dumps({"d": {"other": 5}})}
        self.assertEqual(header_words.from_meta(meta), ["glowstyle", "neon rim"])

    def test_tags_most_training_pictures_share_without_the_generic_ones(self):
        tags = {"10_mychar": {"mychar": 40, "1girl": 40, "solo": 39, "blue eyes": 36, "looking_at_viewer": 30,
                              "red scarf": 26, "smile": 25, "hat": 5, "score_9": 40},
                "2_extra": {"mychar": 10, "blue eyes": 9}}
        self.assertEqual(header_words.from_meta({"ss_tag_frequency": json.dumps(tags)}), ["mychar", "blue eyes", "red scarf"],
                         "in half as many pictures as the most used tag at least, most used first")

    def test_at_most_five_and_nothing_from_broken_metadata(self):
        many = {"d": {f"tag{number}": 10 for number in range(9)}}
        self.assertEqual(len(header_words.from_meta({"ss_tag_frequency": json.dumps(many)})), 5)
        self.assertEqual(header_words.from_meta({"ss_tag_frequency": "{not json"}), [])
        self.assertEqual(header_words.from_meta({"ss_tag_frequency": json.dumps({"d": {"x": "many", "y": True}})}), [])
        self.assertEqual(header_words.from_meta({"ss_tag_frequency": json.dumps(["a", "b"])}), [])
        self.assertEqual(header_words.from_meta({}), [])

    def test_only_lora_files_are_read(self):
        with tempfile.TemporaryDirectory() as temp:
            tags = {"ss_tag_frequency": json.dumps({"d": {"mychar": 3}})}
            self.assertEqual(header_words.of_file(model_file(temp, "l.safetensors", [LORA_KEY], tags)), ["mychar"])
            checkpoint = model_file(temp, "c.safetensors", ["model.diffusion_model.input_blocks.0.0.weight",
                                                             "first_stage_model.decoder.up.0.block.0.conv1.weight"], tags)
            self.assertEqual(header_words.of_file(checkpoint), [], "a fine-tune's training tags are no trigger words")
            pickle = os.path.join(temp, "x.ckpt")
            Path(pickle).write_bytes(b"\x80\x02whatever")
            self.assertEqual(header_words.of_file(pickle), [], "formats that can carry code are never opened")
            broken = os.path.join(temp, "b.safetensors")
            Path(broken).write_bytes(struct.pack("<Q", 10 ** 12))
            self.assertEqual(header_words.of_file(broken), [])
            self.assertEqual(header_words.of_file(os.path.join(temp, "missing.safetensors")), [])


if __name__ == "__main__":
    unittest.main()
