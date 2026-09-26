"""Unit tests for Persistent Python Kernel and Tool RPC service."""

from pathlib import Path
import pytest
from app.services.code_kernel import (
    PersistentPythonKernel,
    get_or_create_kernel,
    stop_kernel,
)


@pytest.fixture
def clean_kernel(tmp_path: Path):
    session_id = f"test-kernel-{tmp_path.name}"
    kernel = get_or_create_kernel(session_id, cwd=str(tmp_path))
    yield kernel
    stop_kernel(session_id)


def test_kernel_state_persistence(clean_kernel: PersistentPythonKernel):
    # Cell 1: define variable
    res1 = clean_kernel.execute("a = 10\nb = 32")
    assert res1["status"] == "ok"
    assert res1["execution_count"] == 1

    # Cell 2: use variable from previous cell
    res2 = clean_kernel.execute("print(a + b)")
    assert res2["status"] == "ok"
    assert res2["execution_count"] == 2
    assert "42" in res2["stdout"]


def test_kernel_tools_rpc(clean_kernel: PersistentPythonKernel, tmp_path: Path):
    # Create sample file in kernel cwd
    sample = tmp_path / "hello.txt"
    sample.write_text("Hello from Antigravity Kernel Tool RPC!\nLine 2\n", encoding="utf-8")

    code = """
content = tools.view_file("hello.txt")
files = tools.list_dir(".")
print(f"Read {len(content)} chars")
print(f"Found {len(files)} files")
"""
    res = clean_kernel.execute(code)
    assert res["status"] == "ok"
    assert "Read 47 chars" in res["stdout"]
    assert "Found 1 files" in res["stdout"]


def test_kernel_reset(clean_kernel: PersistentPythonKernel):
    clean_kernel.execute("x = 'persisted'")
    assert "x" in clean_kernel.globals

    clean_kernel.reset()
    assert "x" not in clean_kernel.globals
    assert clean_kernel.execution_count == 0

    res = clean_kernel.execute("print(x)")
    assert res["status"] == "error"
    assert "NameError" in res["traceback"]
