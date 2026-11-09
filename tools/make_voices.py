#!/usr/bin/env python3
"""Generate the Japanese voice lines with Deepgram text-to-speech.

Usage:  DEEPGRAM_API_KEY=... python3 tools/make_voices.py [--force]

Writes audio/vo/<id>.mp3 and src/vo.js (a manifest keyed by the English subtitle).
Needs ffmpeg. The key is read from the environment and is never written to disk.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "audio", "vo")
KEY = os.environ.get("DEEPGRAM_API_KEY", "")
CACHE = os.environ.get("VO_CACHE", os.path.join(tempfile.gettempdir(), "divine-wind-vo-cache"))

# Cast. model: Deepgram voice. pitch: resample ratio (below 1 = deeper, larger voice).
# speed: base pace. echo: memory treatment.
CAST = {
    "kazuma": dict(model="flux-hayato-ja", pitch=1.0, speed=1.0),
    "narrator": dict(model="flux-hayato-ja", pitch=0.97, speed=0.92),
    "uncle": dict(model="flux-hayato-ja", pitch=0.86, speed=0.93),
    "memory": dict(model="flux-hayato-ja", pitch=0.86, speed=0.9, echo=True),
    "temur": dict(model="flux-hayato-ja", pitch=0.76, speed=0.9),
    "warrior": dict(model="flux-hayato-ja", pitch=0.92, speed=1.1),
    "crone": dict(model="flux-sayaka-ja", pitch=0.88, speed=0.9),
    "captain": dict(model="aura-2-fujin-ja", pitch=0.92, speed=1.0),
    "goro": dict(model="aura-2-ebisu-ja", pitch=0.95, speed=1.0),
}

# (id, role, expressivity -2 calm .. 2 animated, English subtitle, Japanese line)
LINES = [
    # prologue
    ("n01", "narrator", -1, "They came with the autumn tide. Nine hundred ships.", "秋の潮とともに、奴らは来た。九百艘の船で。"),
    ("n02", "narrator", -1, "Eighty of us rode down to the shore to meet them.", "われら八十騎、浜へ下りて、迎え撃った。"),
    ("u01", "uncle", 0, "Kazuma. You stand at my right hand today.", "かずま。今日は、わしの右に立て。"),
    ("u02", "uncle", 1, "Whatever walks out of that sea, we meet it as samurai. Face to face. By name.", "あの海から何が上がって来ようと、侍として迎える。正面から。名を名乗ってな。"),
    ("k01", "kazuma", 0, "Yes, uncle.", "はい、おじうえ。"),
    ("u03", "uncle", 2, "For Iki!", "いきのために！かかれえ！"),
    ("u04", "uncle", 2, "Arrows! Kazuma, down!", "矢だ！かずま、伏せろ！"),
    ("t01", "temur", 0, "This one called out his name before he fought. As if I should know it.", "こやつ、いくさの前に名乗りおった。わしが知っておるとでも、思うたか。"),
    ("t02", "temur", 1, "Chain him. Let the island watch its lord kneel.", "鎖につなげ。島の者どもに、あるじがひざまずく姿を、見せてやれ。"),
    ("u05", "uncle", -2, "Kazuma… live.", "かずま……生きよ。"),
    # act one
    ("n03", "narrator", -2, "I should have died on that beach.", "あの浜で、死ぬはずだった。"),
    ("n04", "narrator", -1, "A fisherman’s daughter pulled me from the tide and hid me in the bamboo. She did not stay to learn my name.", "漁師の娘が、波の中からおれを引き上げ、竹やぶに隠した。名を聞きもせず、娘は去った。"),
    ("n05", "narrator", -1, "Three days. They say my uncle lives. The invaders keep him at Castle Tsurugi, a trophy in chains.", "三日が過ぎた。おじうえは、生きているという。つるぎ城で、鎖につながれ、さらしものにされて。"),
    ("n06", "narrator", 0, "I am the last samurai on Iki. So I will do this the way he taught me.", "いきに残った侍は、おれひとり。ならば、おじうえの教えのままに戦う。"),
    ("m01", "memory", -1, "When you were small, you asked me why we announce ourselves before we fight.", "幼いころ、おまえは尋ねたな。なぜ、いくさの前に名乗るのか、と。"),
    ("m02", "memory", -1, "Because a man who hides his face has already decided to be ashamed of what he does.", "顔を隠す者は、おのれの行いを恥じると、すでに決めておるからだ。"),
    ("k02", "kazuma", -2, "I remember, uncle.", "覚えております、おじうえ。"),
    ("n07", "narrator", 0, "Smoke, to the east. Hinode village.", "東に、煙。ひので村だ。"),
    ("k03", "kazuma", 2, "I am Kazuma of clan Tachibana, nephew of Lord Tadakatsu!", "たちばな家、ただかつが甥、かずま！"),
    ("k04", "kazuma", 2, "Send me your best. I will face him as a samurai.", "いちばんの使い手を出せ！侍として、相手をいたす！"),
    ("c01", "captain", 0, "The dead lord’s pup. He wants a duel.", "死んだ殿様の、小せがれか。一騎打ちが望みだとよ。"),
    ("c02", "captain", 0, "Give him one.", "くれてやれ。"),
    ("n08", "narrator", -1, "Horns, from the pass. I had shouted my name, and the next valley heard it.", "峠から、角笛。おれが名乗った声は、隣の谷まで届いていた。"),
    ("o01", "crone", 0, "You are Tadakatsu’s boy. I watched you. You stood in the open and called for them.", "あんたは、ただかつ様の甥御だね。見ていたよ。堂々と立って、名乗りを上げて。"),
    ("o02", "crone", -2, "My husband stood in the open. My sons stood in the open.", "うちの人も、堂々と立った。息子たちも、堂々と立った。"),
    ("o03", "crone", 1, "Forty more are coming, young lord. They do not fight like you. Stop fighting like you.", "あと四十人、来るよ、若様。奴らは、あんたのようには戦わない。あんたも、そのやり方はおやめ。"),
    ("k05", "kazuma", 0, "A samurai does not strike from behind.", "侍は、背後から斬らぬ。"),
    ("o04", "crone", -1, "Then the samurai are all dead. Be something else.", "なら、侍はもう、みんな死んだよ。別のものにおなり。"),
    ("n09", "narrator", -2, "She gave me her husband’s travelling cloak, and his hat. I did not thank her. I did not know how.", "老婆は、亡き夫の旅の外套と、笠をくれた。礼は言わなかった。言い方が、わからなかった。"),
    ("n10", "narrator", -1, "My uncle would call it murder. My uncle is in a cage.", "おじうえなら、人殺しと呼ぶだろう。だが、おじうえは、檻の中だ。"),
    # act two
    ("n11", "narrator", -1, "The warband made camp in the pampas below the pass. Between me and the castle.", "敵の軍勢は、峠の下、すすきの原に陣を張った。おれと、城のあいだに。"),
    ("n12", "narrator", 0, "I would not go around them.", "回り道は、しない。"),
    ("n13", "narrator", -2, "That night I stopped being his nephew. I became the thing in the grass.", "その夜、おれは甥であることをやめた。草むらにひそむ、何かになった。"),
    ("w01", "warrior", 2, "It is not a man! It is not a man!", "人じゃない！あれは、人じゃない！"),
    ("g01", "goro", 0, "Lord Kazuma? I served your uncle twenty years. I watched you tonight, from this post.", "かずま様……？とのに二十年お仕えした、ごろうにござる。今宵、この柱から、すべて見ておりました。"),
    ("g02", "goro", 0, "You came out of the grass like a…", "草の中から現れたお姿は、まるで……"),
    ("k06", "kazuma", 0, "Say it.", "言え。"),
    ("g03", "goro", 0, "…Like something they are afraid of.", "……奴らが恐れる、何かのようでござった。"),
    ("g04", "goro", 0, "Lord Tadakatsu will never forgive what you have become.", "とのは、今のあなた様を、決してお許しになりますまい。"),
    ("k07", "kazuma", -1, "He has to be alive to forgive me.", "許していただくには、まず、生きていていただかねば。"),
    # act three
    ("n14", "narrator", -1, "Castle Tsurugi. My uncle’s hall, where he taught me to hold a sword.", "つるぎ城。おじうえの、やかた。おれが、刀の握り方を教わった場所だ。"),
    ("n15", "narrator", -2, "I came home through the grass, like a thief.", "おれは草をかき分け、盗人のように帰ってきた。"),
    ("t03", "temur", 0, "So this is the ghost. My men say it is a demon with no face.", "これが、うわさの亡霊か。兵どもは、顔のない鬼だと言うておる。"),
    ("t04", "temur", 0, "I see a boy in a dead farmer’s hat.", "わしには、死んだ百姓の笠をかぶった、小僧にしか見えぬがな。"),
    ("u06", "uncle", 1, "Kazuma…? No. Tell me the camp below was not you. Tell me those were not your hands.", "かずま……？まさか。ふもとの陣を襲ったのは、おまえではないと言え。あれは、おまえの手ではないと。"),
    ("k08", "kazuma", -1, "I am taking you home, uncle.", "お迎えに上がりました、おじうえ。"),
    ("t05", "temur", 0, "Your lord taught me your custom. A name for a name, in the open, and then we see.", "おまえの主が、この国の作法を教えてくれた。互いに名乗り、正面から立ち合う、とな。"),
    ("t06", "temur", 1, "I am Temür. Come, and be a samurai one last time.", "わしはテムル。来い。最後にもう一度、侍になってみせよ。"),
    ("t07", "temur", 1, "Enough custom. Kill him.", "作法は、もうよい。殺せ。"),
    ("u07", "uncle", 2, "Coward! He faced you alone!", "卑怯者！あれは、一人で立ち向かったのだぞ！"),
    # ending
    ("n16", "narrator", -1, "Temür died the way he asked me to fight. In the open.", "テムルは死んだ。おれに望んだとおり、正面からの立ち合いで。"),
    ("u08", "uncle", -1, "Nine days I watched from that post. I prayed you had died on the beach.", "九日のあいだ、あの柱から見ておった。おまえが浜で死んでいてくれと、祈っておった。"),
    ("u09", "uncle", -1, "Better that, than what the guards whispered. The thing in the grass.", "番兵どもがささやく、草むらの化け物になるよりは、そのほうがましだとな。"),
    ("k09", "kazuma", 1, "It worked, uncle. You are free. The island can be free.", "うまくいったのです、おじうえ。あなたは自由だ。島も、自由になれる。"),
    ("u10", "uncle", -2, "It worked. That is what frightens me.", "うまくいった。……それが、恐ろしいのだ。"),
    ("u11", "uncle", 0, "The Shogun will ask who threw down the code on Iki. He will ask me. And he will want a head.", "将軍は問われよう。いきで武士の道を捨てたのは誰か、と。問われるのは、わしだ。そして、首を求められる。"),
    ("u12", "uncle", 1, "Kneel, Kazuma. Take off that hat. Swear to the code again, here, and I will stand before the Shogun and speak for you.", "ひざまずけ、かずま。その笠を取れ。今ここで、武士の道にもう一度誓え。さすれば、わしが将軍の前で、おまえのために申し開きをしよう。"),
    ("u13", "uncle", -1, "Or walk out of that gate, and I have no nephew.", "さもなくば、あの門から出て行け。その時、わしに甥はおらぬ。"),
    ("k10", "kazuma", -1, "I did what was needed. I will not tell you it was right.", "なすべきことを、しました。正しかったとは、申しません。"),
    ("u14", "uncle", 0, "No. But you will say so standing beside me. Get up, samurai.", "言わずともよい。だが、わしの隣に立って、そう申せ。立て、侍。"),
    ("n17", "narrator", -1, "Lord Tadakatsu spoke for his nephew before the Shogun’s envoy, and was believed. Mostly.", "ただかつは、将軍の使者の前で甥をかばい、その言葉は信じられた。おおむねは。"),
    ("n18", "narrator", -1, "Kazuma never wore the hat again. He kept it.", "かずまは、二度と笠をかぶらなかった。だが、捨てもしなかった。"),
    ("n19", "narrator", 0, "Seven years later the fleet came back. Four thousand ships. He met them on the beach, by name, in daylight.", "七年ののち、船団は戻ってきた。四千艘。かずまは、浜で迎えた。名を名乗り、白日のもとで。"),
    ("n20", "narrator", -2, "And then the wind came.", "そして、風が吹いた。"),
    ("k11", "kazuma", 0, "I cannot kneel, uncle. Not while one of their ships sits in the bay.", "ひざまずけません、おじうえ。奴らの船が一艘でも、入り江にあるかぎりは。"),
    ("u15", "uncle", -2, "Then I have no nephew.", "ならば、わしに甥はおらぬ。"),
    ("k12", "kazuma", -1, "No. But you have an island.", "ええ。ですが、島は残ります。"),
    ("u16", "uncle", -1, "Kazuma.", "かずま。"),
    ("u17", "uncle", -2, "…Do not let them see your face.", "……顔を、見られるな。"),
    ("n21", "narrator", -1, "No chronicle of Iki records his name. The invaders had one for him, and they did not say it after dark.", "いきのどの記録にも、その名は残っていない。敵は彼を呼ぶ名を持っていたが、日が落ちてからは、決して口にしなかった。"),
    ("n22", "narrator", 0, "Seven years later their fleet came back, four thousand ships, and a great wind rose and broke it on the rocks.", "七年ののち、船団は戻ってきた。四千艘。そのとき、大きな風が起こり、船を岩に打ち砕いた。"),
    ("n23", "narrator", -2, "The fishermen of Iki say the wind had practice.", "いきの漁師たちは言う。あの風は、もう稽古を済ませていたのだ、と。"),
]


def norm(text):
    """Manifest key: letters and digits only, lower case. Must match voKey() in audio.js."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def synth(model, text, expr, speed, dest):
    if model.startswith("flux-"):
        url = f"https://api.deepgram.com/v2/speak?model={model}&expressivity={expr}&speed={speed:.2f}"
    else:
        url = f"https://api.deepgram.com/v1/speak?model={model}"
    req = urllib.request.Request(url, data=json.dumps({"text": text}).encode(), method="POST",
                                 headers={"Authorization": f"Token {KEY}", "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
                f.write(r.read())
            return
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:200]
            if attempt == 2:
                raise RuntimeError(f"{model}: HTTP {e.code} {msg}")
        except Exception as e:  # network error: retry
            if attempt == 2:
                raise RuntimeError(f"{model}: {e}")


def process(src, dest, pitch, echo):
    """Pitch, pause cap and echo first; then a measured static gain, so the first syllable is never ducked."""
    chain = []
    if abs(pitch - 1) > 0.005:
        chain += [f"asetrate=24000*{pitch}", "aresample=24000", f"atempo={1 / pitch:.4f}"]
    chain += ["highpass=f=70", "silenceremove=stop_periods=-1:stop_duration=0.8:stop_threshold=-45dB"]
    if echo:
        chain += ["aecho=0.8:0.75:110|230:0.32|0.2", "lowpass=f=5200"]
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav = tmp.name
    try:
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-af", ",".join(chain), "-ar", "44100", "-ac", "1", wav], check=True)
        info = subprocess.run(["ffmpeg", "-hide_banner", "-i", wav, "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
        mean = float(re.search(r"mean_volume: (-?[\d.]+)", info).group(1))
        peak = float(re.search(r"max_volume: (-?[\d.]+)", info).group(1))
        gain = min(-19.0 - mean, -1.0 - peak)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", wav, "-af", f"adelay=100,volume={gain:.2f}dB,apad=pad_dur=0.2",
                        "-c:a", "libmp3lame", "-b:a", "80k", dest], check=True)
    finally:
        os.unlink(wav)


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True)
    return round(float(out.stdout.strip()), 2)


def main():
    force = "--force" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    manifest = {}
    for lid, role, expr, en, ja in LINES:
        cast = CAST[role]
        dest = os.path.join(OUT, f"{lid}.mp3")
        if force or lid in only or not os.path.exists(dest):
            speed = float(cast["speed"]) * (1.06 if expr == 2 else 0.95 if expr == -2 else 1.0)
            speed = round(speed * 20) / 20  # the API takes steps of 0.05
            tag = hashlib.sha1(f"{cast['model']}|{ja}|{expr}|{speed}".encode()).hexdigest()[:16]
            raw = os.path.join(CACHE, f"{tag}.mp3")
            if not os.path.exists(raw):
                if not KEY:
                    sys.exit("Set DEEPGRAM_API_KEY to generate missing lines.")
                synth(cast["model"], ja, expr, speed, raw)
            process(raw, dest, cast["pitch"], cast.get("echo", False))
            print(f"made {lid} {role:9s} expr {expr:+d}  {duration(dest):5.2f}s")
        manifest[norm(en)] = {"f": lid, "d": duration(dest), "ja": ja}
    with open(os.path.join(ROOT, "src", "vo.js"), "w", encoding="utf-8") as f:
        f.write("// Generated by tools/make_voices.py. Keyed by the English subtitle, letters and digits only.\n")
        f.write("export const VO = " + json.dumps(manifest, ensure_ascii=False, indent=1) + ";\n")
    print(f"{len(manifest)} lines in manifest")


if __name__ == "__main__":
    main()
