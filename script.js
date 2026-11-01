var CATEGORIES = ["Rifle", "Shotgun", "Pistol", "Archgun", "Melee"];

var MULTS = [
    { label: "++", value: 0.99 },
    { label: "++ / -", value: 1.2375 },
    { label: "+++", value: 0.75 },
    { label: "+++ / -", value: 0.9375 }
];

var ALT_VALUES = [0, -0.495, 0, -0.75];
var ALT_LABEL = "Negatives";
var alt = false;

var LOW = 0.9, HIGH = 1.1, BASE = 1.2;
var DATA = [];

var cat = CATEGORIES[0], mult = 3;

var cats = document.getElementById("cats");
var mults = document.getElementById("mults");
var list = document.getElementById("list");
var q = document.getElementById("q");
var count = document.getElementById("count");

var els = {};
var emptyEl = null;

var DUR = 280;
var EASE = "cubic-bezier(.2, .7, .2, 1)";
var LEAVE_EASE = "cubic-bezier(.45, 0, .25, 1)";
var GAP = 8;

var SLIDE_IN_FROM = "-100%";
var SLIDE_OUT_TO = "100%";

var REDUCED = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function collapsed(x) {
    return {
        height: "0px",
        opacity: 0,
        paddingTop: "0px",
        paddingBottom: "0px",
        borderTopWidth: "0px",
        borderBottomWidth: "0px",
        marginBottom: "-" + GAP + "px",
        transform: "translateX(" + x + ")"
    };
}

function statValue(d, category) {
    var want = category.toLowerCase();

    for (var k in d) {
        if (k.toLowerCase() === want && typeof d[k] === "number") {
            return d[k];
        }
    }

    return null;
}

function suffixOf(d) {
    if (typeof d.suffix !== "string" || d.suffix === "null") return "";

    return d.suffix;
}

function fmt(n) {
    return (Math.round(n * 100) / 100).toString();
}


function gradeColour(t) {
    t = Math.max(0, Math.min(1, Number(t) || 0));

    var stops = [
        { at: 0.00, rgb: [220, 38, 38] },
        { at: 0.25, rgb: [249, 115, 22] },
        { at: 0.50, rgb: [250, 204, 21] },
        { at: 0.75, rgb: [163, 230, 53] },
        { at: 1.00, rgb: [22, 163, 74] }
    ];

    for (var i = 0; i < stops.length - 1; i++) {
        var a = stops[i];
        var b = stops[i + 1];

        if (t <= b.at) {
            var local = (t - a.at) / (b.at - a.at);

            var rgb = a.rgb.map(function (channel, index) {
                return Math.round(
                    channel + (b.rgb[index] - channel) * local
                );
            });

            return "rgb(" + rgb.join(", ") + ")";
        }
    }

    return "rgb(22, 163, 74)";
}

function fmtSigned(n, suffix) {
    var r = Math.round(n * 100) / 100;

    if (r === 0) return "0" + suffix;

    return (r > 0 ? "+" : "-") + Math.abs(r) + suffix;
}

function makeGroup(parent, items, isOn, onPick) {
    items.forEach(function (it, i) {
        var b = document.createElement("button");

        b.type = "button";
        b.className = "btn";
        b.innerHTML = it.html;

        b.onclick = function () {
            onPick(i);
            sync();
            render();
        };

        parent.appendChild(b);
    });

    function sync() {
        [].slice.call(parent.children, 0, items.length).forEach(function (b, i) {
            b.setAttribute("aria-pressed", isOn(i) ? "true" : "false");
        });
    }

    sync();

    return sync;
}

var syncCats = makeGroup(
    cats,
    CATEGORIES.map(function (c) {
        return { html: c };
    }),
    function (i) {
        return CATEGORIES[i] === cat;
    },
    function (i) {
        cat = CATEGORIES[i];
    }
);

makeGroup(
    mults,
    MULTS.map(function (m) {
        return { html: m.label };
    }),
    function (i) {
        return i === mult;
    },
    function (i) {
        mult = i;
    }
);


var altBtn = document.createElement("button");

altBtn.type = "button";
altBtn.className = "btn toggle-red";
altBtn.textContent = ALT_LABEL;
altBtn.setAttribute("aria-pressed", alt ? "true" : "false");

altBtn.onclick = function () {
    alt = !alt;

    altBtn.setAttribute("aria-pressed", alt ? "true" : "false");

    render();
};

mults.appendChild(altBtn);

q.oninput = render;


function playEnter(items) {
    if (REDUCED || !items.length || !items[0].animate) return;

    var measured = items.map(function (el) {
        var cs = getComputedStyle(el);

        return {
            el: el,
            to: {
                height: el.offsetHeight + "px",
                opacity: 1,
                paddingTop: cs.paddingTop,
                paddingBottom: cs.paddingBottom,
                borderTopWidth: cs.borderTopWidth,
                borderBottomWidth: cs.borderBottomWidth,
                marginBottom: "0px",
                transform: "translateX(0)"
            }
        };
    });

    measured.forEach(function (x, i) {
        x.el.animate(
            [collapsed(SLIDE_IN_FROM), x.to],
            {
                duration: DUR,
                easing: EASE,
                delay: Math.min(i * 18, 180),
                fill: "backwards"
            }
        );
    });
}

function playLeave(items) {
    if (!items.length) return;

    var measured = items.map(function (el) {
        var cs = getComputedStyle(el);

        return {
            el: el,
            from: {
                height: el.offsetHeight + "px",
                opacity: cs.opacity,
                paddingTop: cs.paddingTop,
                paddingBottom: cs.paddingBottom,
                borderTopWidth: cs.borderTopWidth,
                borderBottomWidth: cs.borderBottomWidth,
                marginBottom: cs.marginBottom,
                transform: cs.transform
            }
        };
    });

    measured.forEach(function (x) {
        var el = x.el;

        function remove() {
            if (el.parentNode) {
                el.parentNode.removeChild(el);
            }
        }

        el.classList.add("leaving");

        if (REDUCED || !el.animate) {
            remove();
            return;
        }

        var a = el.animate(
            [x.from, collapsed(SLIDE_OUT_TO)],
            {
                duration: DUR,
                easing: LEAVE_EASE,
                fill: "forwards"
            }
        );

        a.onfinish = remove;
    });
}

function nextLive(node) {
    while (node && node.classList.contains("leaving")) {
        node = node.nextSibling;
    }

    return node;
}


function fillRow(el, r) {
    el.innerHTML = "";

    var line = document.createElement("div");
    line.className = "stat-line";

    var min = document.createElement("span");
    min.className = "stat-min";
    min.textContent = r.minText || fmtSigned(r.low, "");

    var name = document.createElement("span");
    name.className = "stat-name";
    name.textContent = r.name;

    var read = document.createElement("span");
    read.className = "stat-read";
    read.textContent = r.read || "";

    var max = document.createElement("span");
    max.className = "stat-max";
    max.textContent = r.maxText || fmtSigned(r.high, "");

    line.appendChild(min);
    line.appendChild(name);
    line.appendChild(max);

    el.appendChild(line);

    if (r.grade && r.t !== undefined) {
        var track = document.createElement("div");
        track.className = "grade-track";

        var bar = document.createElement("div");
        bar.className = "grade-bar";

        var marker = document.createElement("div");
        marker.className = "grade-marker";

        marker.textContent = r.read || "";
        marker.style.left = (r.t * 100) + "%";
        marker.style.backgroundColor = gradeColour(r.t);

        bar.appendChild(marker);
        track.appendChild(bar);

        var labels = document.createElement("div");
        labels.className = "grade-labels";

        var gradeMarks = [
            { t: 0.05, grade: "F" },
            { t: 0.14, grade: "C-" },
            { t: 0.23, grade: "C" },
            { t: 0.32, grade: "C+" },
            { t: 0.41, grade: "B-" },
            { t: 0.50, grade: "B" },
            { t: 0.59, grade: "B+" },
            { t: 0.68, grade: "A-" },
            { t: 0.77, grade: "A" },
            { t: 0.86, grade: "A+" },
            { t: 0.95, grade: "S" }
        ];

        gradeMarks.forEach(function (item) {
            var span = document.createElement("span");
            span.textContent = item.grade;
            span.style.left = (item.t * 100) + "%";
            labels.appendChild(span);
        });

        track.appendChild(labels);
        el.appendChild(track);

        el.classList.add("graded");
        el.setAttribute("data-grade", r.grade);
    } else {
        el.classList.remove("graded");
        el.removeAttribute("data-grade");
    }
}

function render() {
    var m = alt ? ALT_VALUES[mult] : MULTS[mult].value;
    var term = q.value.trim().toLowerCase();
    var num = parseFloat(term);

    var rows = [];
    var seen = {};
    var useShot = !!(window.OCR && OCR.active());

    altBtn.disabled = useShot;

    if (useShot) {
        rows = OCR.rows();
    } else {
        DATA.forEach(function (d) {
            var v = statValue(d, cat);

            if (v === null) return;
            if (alt && d.noNegative === true) return;

            var suffix = suffixOf(d);

            var lo = v * LOW * BASE * m;
            var hi = v * HIGH * BASE * m;

            if (d.stat === "Faction Damage") {
                lo += 1;
                hi += 1;
            }

            var key = d.stat;

            seen[key] = (seen[key] || 0) + 1;

            if (seen[key] > 1) {
                key += "#" + seen[key];
            }

            var low = Math.min(lo, hi);
            var high = Math.max(lo, hi);

            rows.push({
                key: key,
                name: d.stat,
                text: fmtSigned(low, suffix) + " → " + fmtSigned(high, suffix),
                low: low,
                high: high,
                minText: fmtSigned(low, suffix),
                maxText: fmtSigned(high, suffix),
                grade: null,
                read: "",
                t: undefined
            });
        });
    }

    rows = rows.filter(function (r) {
        if (!term) return true;

        if (r.name.toLowerCase().indexOf(term) > -1) {
            return true;
        }

        if (!isNaN(num) && num >= r.low && num <= r.high) {
            return true;
        }

        return r.text.toLowerCase().indexOf(term) > -1;
    });

    count.textContent = rows.length + (rows.length === 1 ? " stat" : " stats");

    var keep = {};
    var leaving = [];

    rows.forEach(function (r) {
        keep[r.key] = true;
    });

    Object.keys(els).forEach(function (k) {
        if (!keep[k]) {
            leaving.push(els[k]);
            delete els[k];
        }
    });

    if (!rows.length) {
        playLeave(leaving);

        if (!emptyEl) {
            emptyEl = document.createElement("li");
            emptyEl.className = "empty";
            emptyEl.textContent = "Nothing matches.";

            list.appendChild(emptyEl);

            playEnter([emptyEl]);
        }

        return;
    }

    if (emptyEl) {
        leaving.push(emptyEl);
        emptyEl = null;
    }

    playLeave(leaving);

    var cursor = nextLive(list.firstChild);
    var entering = [];

    rows.forEach(function (r) {
        var el = els[r.key];

        if (!el) {
            el = document.createElement("li");
            el.className = "stat-row";

            els[r.key] = el;
            entering.push(el);
        }

        fillRow(el, r);

        if (el === cursor) {
            cursor = nextLive(cursor.nextSibling);
        } else {
            list.insertBefore(el, cursor);
        }
    });

    playEnter(entering);
}


if (window.OCR) {
    OCR.onChange = render;

    OCR.onDetect = function (w) {
        if (w && w.type) {
            cat = w.type;
            syncCats();
        }
    };
}


fetch("data.json")
    .then(function (r) {
        if (!r.ok) {
            throw new Error("HTTP " + r.status);
        }

        return r.json();
    })
    .then(function (j) {
        DATA = j.filter(function (d) {
            return d && d.stat;
        });

        DATA.forEach(function (d) {
            d.stat = d.stat.trim();
        });

        render();
    })
    .catch(function (err) {
        list.innerHTML = "";

        els = {};
        emptyEl = null;

        var li = document.createElement("li");

        li.className = "empty err";
        li.textContent = "No data.json (" + err.message + "). Contact Useless.";

        list.appendChild(li);
    });

render();