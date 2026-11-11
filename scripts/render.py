"""Render a page of the app offscreen and save a PNG, to check layout at any window size
without needing a visible window.

    VITE_GITHUB_TOKEN=$(gh auth token) npx vite --port 1421 --strictPort &
    WEBKIT_DISABLE_COMPOSITING_MODE=1 python3 scripts/render.py \
        "http://localhost:1421/#/cli/cli" 1440 900 out.png [wait_seconds]

Needs python-gobject and webkit2gtk-4.1. The token only reaches the local dev server.
"""
import sys, gi
gi.require_version('Gtk', '3.0'); gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib
url, w, h, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
wait = float(sys.argv[5]) if len(sys.argv) > 5 else 7
win = Gtk.OffscreenWindow(); win.set_default_size(w, h)
view = WebKit2.WebView(); view.get_settings().set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER); view.set_size_request(w, h); win.add(view); win.show_all()
def snap():
    def done(v, res):
        try:
            v.get_snapshot_finish(res).write_to_png(out); print('saved', out)
        except Exception as e:
            print('snapshot failed', e)
        Gtk.main_quit()
    view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, done)
    return False
def loaded(v, ev):
    if ev == WebKit2.LoadEvent.FINISHED:
        v.run_javascript("document.documentElement.dataset.theme='dark'", None, None)
        GLib.timeout_add(int(wait * 1000), snap)
view.connect('load-changed', loaded)
GLib.timeout_add(60000, Gtk.main_quit)
view.load_uri(url); Gtk.main()
