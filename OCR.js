var OCR = (function () {
    var pasteBox = document.getElementById("paste");
    var clearBtn = document.getElementById("clear");
    var shotWrap = document.getElementById("shotwrap");
    var shotImg = document.getElementById("shot");
    var statusEl = document.getElementById("status");
    var OCR_TARGET_WIDTH = 1600;
    var OCR_MAX_SCALE = 4;
    var OCR_PAD = 24;
    var OCR_BINARIZE = true;
    var OCR_DEBUG = false;
    var WEAPON_FUZZY_MIN = 0.85;
    var MATCH_MIN = 0.55;
    var OCR_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-%./() ";

    var ALIASES = {
        "Critical Chance On Slide": ["Critical Chance for Slide Attack", "Slide Attack Critical Chance"],
        "Chance to gain Combo Count": ["Chance to Gain Extra Combo Count"],
        "Elemental Damage": ["Cold Damage", "Heat Damage", "Toxin Damage", "Electricity Damage"],
        "Physical Damage / IPS": ["Impact Damage", "Puncture Damage", "Slash Damage"],
        "Faction Damage": ["Damage to Grineer", "Damage to Corpus", "Damage to Infested", "Damage to Corrupted"],
        "Fire Rate / Attack Speed": ["Fire Rate", "Attack Speed"],
        "Projctile Speed": ["Projectile Speed"],
        "Weapon Recoil": ["Recoil"],
        "Weakpoint Critical Chance": ["Weak Point Critical Chance"],
        "Weakpoint Damage": ["Weak Point Damage"]
    };
    var GRADE_S = 0.95;
    var GRADE_F = 0.05;

    var BANDS = [
        [0.86, "A+"],
        [0.77, "A"],
        [0.68, "A-"],
        [0.59, "B+"],
        [0.50, "B"],
        [0.41, "B-"],
        [0.32, "C+"],
        [0.23, "C"],
        [0.14, "C-"]
    ];

    var T_SLACK = 0.05;
    var shotLines = null;
    var shotUrl = null;
    var debugCanvas = null;
    var job = 0;
    var ocrWorker = null;
    var shotWeapon = null;
    var weapons = [];
    function normalize(s) {
        return s.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
    }

    function trimJunk(s) {
        var w = s.split(" ");

        while (w.length > 1 && w[w.length - 1].length <= 2) w.pop();

        return w.join(" ");
    }

    function lev(a, b) {
        var prev = [], cur = [], i, j;

        for (j = 0; j <= b.length; j++) prev[j] = j;

        for (i = 1; i <= a.length; i++) {
            cur = [i];

            for (j = 1; j <= b.length; j++) {
                cur[j] = Math.min(
                    prev[j] + 1,
                    cur[j - 1] + 1,
                    prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                );
            }

            prev = cur;
        }

        return prev[b.length];
    }

    function similarity(a, b) {
        if (!a.length && !b.length) return 1;

        return 1 - lev(a, b) / Math.max(a.length, b.length);
    }

    var LINE_RE = /^([+\-\u2212\u2013\u2014]|t)?\s*(x?)(\d+(?:[.,]\d+)?)(%|[xsm](?=\s|$))?\s*(.*\S)\s*$/i;

    var SEG_RE = /([+\-\u2212\u2013\u2014]|\bt)\s*(x?)(\d+(?:[.,]\d+)?)(%|[xsm](?=\s|$))?\s*([^+\-\u2212\u2013\u2014]*)/gi;

    function statFrom(m, raw) {
        var name = (m[5] || "").trim();

        if (normalize(name).length < 3) return null;

        return {
            raw: raw,
            sign: m[1] ? (/^[+t]$/i.test(m[1]) ? "+" : "-") : "",
            value: parseFloat(m[3].replace(",", ".")),
            suffix: (m[4] || (m[2] ? "x" : "")).toLowerCase(),
            name: name
        };
    }

    function splitLines(text) {
        var lines = [];
        var perLine = [];

        text.split(/\r?\n/).forEach(function (raw) {
            var line = raw.trim();

            if (!line) return;

            lines.push(line);

            var segs = [], m;

            SEG_RE.lastIndex = 0;

            while ((m = SEG_RE.exec(line)) !== null) {
                var st = statFrom(m, m[0].trim());

                if (st) segs.push(st);
            }

            if (!segs.length) {
                var u = LINE_RE.exec(line.replace(/^[^A-Za-z0-9+\-\u2212\u2013\u2014]+/, ""));
                var st2 = u && statFrom(u, line);

                if (st2) segs.push(st2);
            }

            perLine.push(segs);
        });

        var stats = [];

        perLine.forEach(function (segs, i) {
            segs.forEach(function (st, j) {
                st.cont = (j === segs.length - 1 && i + 1 < lines.length && !perLine[i + 1].length) ? lines[i + 1] : "";
                stats.push(st);
            });
        });

        return { stats: stats, lines: lines };
    }

    function parseLines(text) {
        return splitLines(text).stats;
    }


    function readWeapons(j) {
        var out = [];

        function add(name, type) {
            if (typeof name === "string" && name.trim()) {
                out.push({ name: name.trim(), type: typeof type === "string" ? type : "" });
            }
        }

        function fromObj(w, fallbackType) {
            add(w.name || w.weapon || w.Name, w.type || w.category || w.class || w.Type || fallbackType);
        }

        if (Array.isArray(j)) {
            j.forEach(function (w) {
                if (w && typeof w === "object") fromObj(w, "");
            });
        } else if (j && typeof j === "object") {
            Object.keys(j).forEach(function (k) {
                var v = j[k];

                if (typeof v === "string") {
                    add(k, v);
                } else if (Array.isArray(v)) {
                    v.forEach(function (w) {
                        if (typeof w === "string") add(w, k);
                        else if (w && typeof w === "object") fromObj(w, k);
                    });
                } else if (v && typeof v === "object") {
                    add(k, v.type || v.category);
                }
            });
        }

        return out;
    }

    function catFromType(t) {
        var key = String(t || "").toLowerCase().replace(/[^a-z]/g, "");
        var found = null;

        CATEGORIES.forEach(function (c) {
            var ck = c.toLowerCase();

            if (key === ck || key === ck + "s") found = c;
        });

        return found;
    }

    var weaponsReady = fetch("weapons.json")
        .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);

            return r.json();
        })
        .then(function (j) {
            weapons = readWeapons(j).map(function (w) {
                var n = normalize(w.name);

                return { name: w.name, type: w.type, n: n, words: n ? n.split(" ") : [] };
            }).filter(function (w) {
                return w.n.length >= 3;
            });

            if (!weapons.length) console.warn("weapons.json: no usable {name, type} entries found");
        })
        .catch(function (err) {
            console.warn("weapons.json not loaded: " + err.message);
        });

    function detectWeapon(lines) {
        var best = null;

        lines.forEach(function (raw) {
            var line = normalize(raw);

            if (!line) return;

            var words = line.split(" ");
            var padded = " " + line + " ";

            weapons.forEach(function (w) {
                var score = 0;

                if (padded.indexOf(" " + w.n + " ") > -1) {
                    score = 1;
                } else if (w.n.length >= 5) {
                    var k = w.words.length;

                    for (var i = 0; i + k <= words.length; i++) {
                        var s = similarity(words.slice(i, i + k).join(" "), w.n);

                        if (s > score) score = s;
                    }

                    if (score < WEAPON_FUZZY_MIN) score = 0;
                }

                if (!score) return;

                if (!best ||
                    w.words.length > best.w.words.length ||
                    (w.words.length === best.w.words.length && score > best.score)) {
                    best = { w: w, score: score };
                }
            });
        });

        if (best) {
            return { name: best.w.name, type: catFromType(best.w.type) };
        }

        for (var i = 0; i < lines.length; i++) {
            var l = normalize(lines[i]).replace("arch gun", "archgun");

            if (l.indexOf("riven") === -1) continue;

            for (var c = 0; c < CATEGORIES.length; c++) {
                if (l.indexOf(CATEGORIES[c].toLowerCase()) > -1) {
                    return { name: null, type: CATEGORIES[c] };
                }
            }
        }

        return null;
    }


    function matchLines(lines, log) {
        var cands = [];
        var matched = [];
        var missed = [];
        var at = {};

        DATA.forEach(function (d) {
            cands.push({
                d: d,
                avail: statValue(d, cat) !== null,
                names: [d.stat].concat(ALIASES[d.stat] || []).map(normalize)
            });
        });

        lines.forEach(function (line) {
            var nm = trimJunk(normalize(line.name));
            var scored = [];

            var variants = [nm];
            var contWords = normalize(line.cont || "").split(" ").filter(Boolean);

            for (var k = 1; k <= Math.min(3, contWords.length); k++) {
                variants.push(trimJunk(normalize(line.name + " " + contWords.slice(0, k).join(" "))));
            }

            cands.forEach(function (c) {
                var top = 0, topV = nm;

                c.names.forEach(function (n) {
                    variants.forEach(function (v) {
                        var s = Math.max(
                            similarity(v, n),
                            similarity(v.replace(/ /g, ""), n.replace(/ /g, ""))
                        );

                        if (n.length >= 8 && v.indexOf(n) > -1) s = Math.max(s, 0.85);

                        if (line.suffix === suffixOf(c.d)) s = Math.min(1, s + 0.1);

                        if (s > top) {
                            top = s;
                            topV = v;
                        }
                    });
                });

                scored.push({ d: c.d, avail: c.avail, score: top, via: topV });
            });

            scored.sort(function (x, y) {
                return y.score - x.score;
            });

            var best = null, off = null, runner = null;

            scored.forEach(function (x) {
                if (x.avail) {
                    if (!best) best = x;
                    else if (!runner) runner = x;
                } else if (!off) {
                    off = x;
                }
            });

            if (log) {
                console.log("OCR match: \"" + (best ? best.via : nm) + "\" ->",
                    best ? best.d.stat + " (" + best.score.toFixed(2) + ")" : "none",
                    "| runner-up:", runner ? runner.d.stat + " (" + runner.score.toFixed(2) + ")" : "none",
                    "| best unavailable for " + cat + ":", off ? off.d.stat + " (" + off.score.toFixed(2) + ")" : "none");
            }

            if (off && off.score >= MATCH_MIN && (!best || off.score > best.score + 0.02)) {
                missed.push(line.raw + " [reads as " + off.d.stat + ", which has no " + cat + " value in data.json]");
                return;
            }

            if (!best || best.score < MATCH_MIN) {
                missed.push(line.raw);
                return;
            }

            var hit = { d: best.d, line: line, score: best.score };

            if (at[best.d.stat] !== undefined) {
                if (best.score > matched[at[best.d.stat]].score) {
                    matched[at[best.d.stat]] = hit;
                }

                return;
            }

            at[best.d.stat] = matched.length;
            matched.push(hit);
        });

        return { matched: matched, missed: missed };
    }

    function tOf(x, lo, hi) {
        return (x - lo) / (hi - lo);
    }

    function pickMode(d, v, line) {
        var modes = [{ m: MULTS[mult].value, neg: false }];

        if (d.noNegative !== true) {
            modes.push({ m: ALT_VALUES[mult], neg: true });
        }

        var best = null;

        modes.forEach(function (md) {
            var lo = v * LOW * BASE * md.m;
            var hi = v * HIGH * BASE * md.m;

            if (d.stat === "Faction Damage") {
                lo += 1;
                hi += 1;
            }

            if (lo === hi) return;

            var t;

            if (line.sign) {
                t = tOf(line.sign === "-" ? -line.value : line.value, lo, hi);
            } else {
                t = tOf(line.value, Math.abs(lo), Math.abs(hi));
            }

            var dist = Math.max(0, -t, t - 1);

            if (!best || dist < best.dist) {
                best = { lo: lo, hi: hi, t: t, dist: dist, neg: md.neg };
            }
        });

        return best;
    }

    function gradeFor(t) {
        t = Math.max(0, Math.min(1, t));

        if (t <= GRADE_F) return "F";
        if (t >= GRADE_S) return "S";

        for (var i = 0; i < BANDS.length; i++) {
            if (t >= BANDS[i][0]) return BANDS[i][1];
        }

        return "C-";
    }


    function otsu(hist, total) {
        var sum = 0, sumB = 0, wB = 0, best = 0, thr = 127, t;

        for (t = 0; t < 256; t++) sum += t * hist[t];

        for (t = 0; t < 256; t++) {
            wB += hist[t];

            if (!wB) continue;

            var wF = total - wB;

            if (!wF) break;

            sumB += t * hist[t];

            var mB = sumB / wB;
            var mF = (sum - sumB) / wF;
            var between = wB * wF * (mB - mF) * (mB - mF);

            if (between > best) {
                best = between;
                thr = t;
            }
        }

        return thr;
    }

    function preprocess(img) {
        var scale = Math.min(OCR_MAX_SCALE, Math.max(1, OCR_TARGET_WIDTH / img.naturalWidth));
        var w = Math.round(img.naturalWidth * scale);
        var h = Math.round(img.naturalHeight * scale);

        var work = document.createElement("canvas");
        work.width = w;
        work.height = h;

        var wctx = work.getContext("2d", { willReadFrequently: true });
        wctx.imageSmoothingEnabled = true;
        wctx.imageSmoothingQuality = "high";
        wctx.drawImage(img, 0, 0, w, h);

        var id = wctx.getImageData(0, 0, w, h);
        var px = id.data;
        var n = w * h;
        var gray = new Uint8Array(n);
        var hist = new Array(256).fill(0);
        var sum = 0, i;

        for (i = 0; i < n; i++) {
            var g = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);

            gray[i] = g;
            hist[g]++;
            sum += g;
        }

        var thr = otsu(hist, n);
        var brightCount = 0;

        for (i = 0; i < n; i++) {
            if (gray[i] > thr) brightCount++;
        }

        var textIsBright = brightCount < n / 2;

        for (i = 0; i < n; i++) {
            var v;

            if (OCR_BINARIZE) {
                var isBright = gray[i] > thr;

                v = (isBright === textIsBright) ? 0 : 255;
            } else {
                v = textIsBright ? 255 - gray[i] : gray[i];
            }

            px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
            px[i * 4 + 3] = 255;
        }

        wctx.putImageData(id, 0, 0);

        var out = document.createElement("canvas");
        out.width = w + OCR_PAD * 2;
        out.height = h + OCR_PAD * 2;

        var octx = out.getContext("2d");
        octx.fillStyle = "#fff";
        octx.fillRect(0, 0, out.width, out.height);
        octx.drawImage(work, OCR_PAD, OCR_PAD);

        return out;
    }


    function setStatus(t) {
        statusEl.textContent = t;
        statusEl.hidden = !t;
    }

    statusEl.hidden = true;

    var lastInfo = "";

    function info(t) {
        setStatus("");

        if (t !== lastInfo) {
            lastInfo = t;
            console.log("OCR info: " + t);
        }
    }

    function getWorker() {
        if (typeof Tesseract === "undefined") {
            return Promise.reject(new Error("Tesseract.js didn't load"));
        }

        if (!ocrWorker) {
            ocrWorker = Tesseract.createWorker("eng", 1, {
                logger: function (m) {
                    if (m.status === "recognizing text") {
                        setStatus("Reading screenshot... " + Math.round(m.progress * 100) + "%");
                    }
                }
            }).then(function (w) {
                return w.setParameters({
                    tessedit_pageseg_mode: "6",
                    preserve_interword_spaces: "1",
                    tessedit_char_whitelist: OCR_WHITELIST
                }).then(function () {
                    return w;
                });
            });

            ocrWorker.catch(function () {
                ocrWorker = null;
            });
        }

        return ocrWorker;
    }

    function loadImage(url) {
        return new Promise(function (resolve, reject) {
            var im = new Image();

            im.onload = function () {
                resolve(im);
            };

            im.onerror = function () {
                reject(new Error("Couldn't read that image"));
            };

            im.src = url;
        });
    }

    function handleImage(file) {
        var mine = ++job;

        lastInfo = "";

        if (shotUrl) URL.revokeObjectURL(shotUrl);

        shotUrl = URL.createObjectURL(file);
        shotImg.src = shotUrl;
        shotWrap.hidden = false;
        clearBtn.hidden = false;
        shotLines = null;

        api.onChange();
        setStatus("Loading screenshot...");

        var canvas;

        loadImage(shotUrl)
            .then(function (img) {
                canvas = preprocess(img);

                if (OCR_DEBUG) {
                    if (debugCanvas) debugCanvas.remove();

                    debugCanvas = canvas;
                    canvas.className = "debug";
                    shotWrap.appendChild(canvas);
                }

                setStatus("Starting OCR...");

                return getWorker();
            })
            .then(function (w) {
                return w.recognize(canvas);
            })
            .then(function (res) {
                return weaponsReady.then(function () {
                    return res;
                });
            })
            .then(function (res) {
                if (mine !== job) return;

                console.log("OCR text:\n" + res.data.text);

                var sp = splitLines(res.data.text);

                shotLines = sp.stats;
                shotWeapon = detectWeapon(sp.lines);

                console.log("OCR weapon:", shotWeapon);

                if (shotWeapon && shotWeapon.type) api.onDetect(shotWeapon);

                matchLines(shotLines, true);
                api.onChange();
            })
            .catch(function (err) {
                if (mine !== job) return;

                setStatus("OCR failed: " + err.message);
            });
    }

    function clearShot() {
        job++;
        lastInfo = "";
        shotLines = null;
        shotWeapon = null;

        if (shotUrl) URL.revokeObjectURL(shotUrl);

        shotUrl = null;
        shotImg.removeAttribute("src");
        shotWrap.hidden = true;
        clearBtn.hidden = true;

        if (debugCanvas) {
            debugCanvas.remove();
            debugCanvas = null;
        }

        setStatus("");
        api.onChange();
    }

    clearBtn.onclick = clearShot;

pasteBox.onclick = async function () {
    try {
        var items = await navigator.clipboard.read();

        for (var i = 0; i < items.length; i++) {
            var imageType = items[i].types.find(function (type) {
                return type.indexOf("image/") === 0;
            });

            if (!imageType) continue;

            var blob = await items[i].getType(imageType);

            var file = new File([blob], "screenshot.png", {
                type: imageType
            });

            handleImage(file);
            return;
        }

        setStatus("No screenshot found in clipboard. Copy an image first.");
    } catch (err) {
        console.error("Clipboard access failed:", err);
        setStatus("Clipboard access blocked. Try Ctrl+V instead.");
    }
};

pasteBox.oninput = function () {
    pasteBox.value = "";
};

document.addEventListener("paste", function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];

    for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image/") === 0) {
            var file = items[i].getAsFile();

            if (file) {
                e.preventDefault();
                handleImage(file);
                return;
            }
        }
    }

    if (e.target === pasteBox) {
        e.preventDefault();
    }
});


    function weaponNote() {
        if (shotWeapon && shotWeapon.name) {
            return "Weapon: " + shotWeapon.name + (shotWeapon.type ? " (" + shotWeapon.type + ")" : " (type not recognised)") + ". ";
        }

        if (shotWeapon) return "Weapon type: " + shotWeapon.type + " (name not found). ";

        return "Couldn't detect the weapon, using " + cat + ". ";
    }

    function updateStatus(mm) {
        if (!shotLines.length) {
            info(weaponNote() + "No stat lines found. Try cropping tighter around the stats.");
            return;
        }

        var s = weaponNote() + "Read " + shotLines.length + (shotLines.length === 1 ? " stat line" : " stat lines") +
            ", matched " + mm.matched.length + ".";

        var missed = mm.missed.filter(function (m) {
            return !(shotWeapon && shotWeapon.name && normalize(m).indexOf(normalize(shotWeapon.name)) > -1);
        });

        if (missed.length) {
            s += " Couldn't match: " + missed.join(" | ");
        }

        info(s);
    }


    function rows() {
        var out = [];
        var mm = matchLines(shotLines);

        mm.matched.forEach(function (x) {
            var d = x.d;
            var v = statValue(d, cat);
            var suffix = suffixOf(d);
            var p = pickMode(d, v, x.line);

            if (!p) return;

            var ok = p.t >= -T_SLACK && p.t <= 1 + T_SLACK;

            var low = Math.min(p.lo, p.hi);
            var high = Math.max(p.lo, p.hi);

            out.push({
                key: d.stat,
                name: d.stat,
                text: fmtSigned(low, suffix) + " → " + fmtSigned(high, suffix),
                low: low,
                high: high,
                minText: fmtSigned(low, suffix),
                maxText: fmtSigned(high, suffix),
                grade: ok ? gradeFor(p.t) : "?",
                read: x.line.sign + fmt(x.line.value) + suffix,
                t: Math.max(0, Math.min(1, p.t))
            });
        });

        updateStatus(mm);

        return out;
    }

    var api = {
        onChange: function () { },
        onDetect: function () { },
        active: function () { return shotLines !== null; },
        rows: rows
    };

    return api;
})();
