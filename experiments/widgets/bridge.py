"""
A comm for a Pyodide that is nobody's kernel.

ipywidgets needs two things and only two: a channel between the Python object
and its counterpart in the page, and something in JavaScript that knows how to
build that counterpart. The second is a published package. The first is this
file -- and the reason it is this short is that the `comm` package exists
precisely to be replaced: subclass BaseComm, say how a message leaves, assign
`comm.create_comm`. Its own README names JupyterLite's pyolite kernel as doing
exactly this, which is worth knowing: the kernel we were considering adopting
has no privileged access to Pyodide that we lack. It plugs in the same way.

Deliberately not handled, because the question is whether the channel works at
all: binary buffers (a slider needs none), and the display protocol -- the
widget is reached by its model id rather than by `display()`.
"""

import json

import comm as comm_module
from comm.base_comm import BaseComm

# Every comm this session has opened, by id. The manager on the other side
# addresses them by that id, so this is what turns an id back into an object.
COMMS = {}

# Set from JavaScript before anything else: the one function a message leaves
# through.
to_js = None


class JsComm(BaseComm):
    """A comm whose transport is a JavaScript function call."""

    def publish_msg(self, msg_type, data=None, metadata=None, buffers=None, **keys):
        COMMS[self.comm_id] = self
        content = dict(data={} if data is None else data, comm_id=self.comm_id, **keys)
        # JSON across the boundary rather than proxied objects: it is one
        # conversion, it is obvious in the log, and it fails loudly rather
        # than silently handing over something unserialisable.
        to_js(msg_type, json.dumps(content), json.dumps({} if metadata is None else metadata))


comm_module.create_comm = JsComm


def deliver(comm_id, data_json):
    """A message from the page to the widget it belongs to."""
    target = COMMS.get(comm_id)
    if target is None:
        return f"no comm {comm_id}"
    target.handle_msg({"content": {"data": json.loads(data_json), "comm_id": comm_id}, "buffers": []})
    return "ok"
