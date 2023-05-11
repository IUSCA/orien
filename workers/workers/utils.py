from __future__ import annotations  # type unions by | are only available in versions > 3.10

import hashlib
import logging
import os
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from subprocess import Popen, PIPE

# import multiprocessing
# https://stackoverflow.com/questions/30624290/celery-daemonic-processes-are-not-allowed-to-have-children
import billiard as multiprocessing
from sca_rhythm import WorkflowTask

logger = logging.getLogger(__name__)


def checksum(fname: Path | str):
    m = hashlib.md5()
    with open(str(fname), "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            m.update(chunk)
    return m.hexdigest()

    # python 3.11
    # with open(fname, 'rb') as f:
    #     digest = hashlib.file_digest(f, 'md5')


#
# def checksum_py311(fname):
#     with open(fname, 'rb') as f:
#         digest = hashlib.file_digest(f, 'md5')
#         return digest.hexdigest()


def execute_old(cmd, cwd=None):
    if not cwd:
        cwd = os.getcwd()
    env = os.environ.copy()
    with Popen(cmd, cwd=cwd, stdout=PIPE, stderr=PIPE, shell=True, env=env) as p:
        stdout_lines = []
        for line in p.stdout:
            stdout_lines.append(line)
        return p.pid, stdout_lines, p.returncode


class SubprocessError(Exception):
    pass


def execute(cmd: list[str], cwd: str = None) -> tuple[str, str]:
    """
    returns stdout, stderr (strings)
    if the return code is not zero, SubprocessError is raised with a dict of
    {
        'return_code': 1,
        'stdout': '',
        'stderr': '',
        'args': []
    }
    """
    logger.info(f'executing {cmd} in CWD {cwd}')
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if p.returncode != 0:
        msg = {
            'return_code': p.returncode,
            'stdout': p.stdout,
            'stderr': p.stderr,
            'args': p.args
        }
        raise SubprocessError(msg)
    return p.stdout, p.stderr


def total_size(dir_path: Path | str):
    """
    can throw CalledProcessError
    can throw IndexError: list index out of range - if the stdout is not in expected format
    can throw ValueError - invalid literal for int() with base 10 - if the stdout is not in expected format
    """
    completed_proc = subprocess.run(['du', '-sb', str(dir_path)], capture_output=True, check=True, text=True)
    return int(completed_proc.stdout.split()[0])


@contextmanager
def track_progress_parallel(progress_fn, progress_fn_args, loop_delay=5):
    def progress_loop():
        while True:
            time.sleep(loop_delay)
            try:
                progress_fn(*progress_fn_args)
            except Exception as e:
                # log the exception message without stacktrace
                logger.warning('exception in parallel progress loop: %s', e)

    p = None
    try:
        # start a subprocess to call progress_loop every loop_delay seconds
        p = multiprocessing.Process(target=progress_loop)
        p.start()
        logger.info(f'starting a sub process to track progress with pid: {p.pid}')
        yield p  # inside the context manager
    finally:
        # terminate the sub process
        logger.info(f'terminating progress tracker: {p.pid}')
        if p is not None:
            p.terminate()


def progress(name, done, total=None):
    percent_done = None
    if total:
        percent_done = done * 1.0 / total
    return {
        'name': name,
        'percent_done': percent_done,
        'done': done,
        'total': total,
        'units': 'bytes',
    }


def file_progress(celery_task: WorkflowTask,
                  path: Path | str,
                  total: int,
                  progress_name: str) -> None:
    size = Path(path).stat().st_size
    name = progress_name
    r = progress(name=name, done=size, total=total)
    celery_task.update_progress(r)


def parse_number(x, default=None, func=int):
    if x is None:
        return x
    try:
        return func(x)
    except ValueError:
        return default


def convert_size_to_bytes(size_str: str) -> int:
    num, unit = size_str[:-1], size_str[-1]
    if unit == "K":
        return int(float(num) * 1024)
    elif unit == "M":
        return int(float(num) * 1024 ** 2)
    elif unit == "G":
        return int(float(num) * 1024 ** 3)
    elif unit == "T":
        return int(float(num) * 1024 ** 4)
    else:
        return parse_number(size_str, default=size_str)


def merge(a: dict, b: dict) -> dict:
    """
    "merges b into a"

    a = {
        1: {"a":"A"},
        2: {"b":"B"},
        3: [1,2,3],
        4: {'a': {'b': 2}}
    }

    b = {
        2: {"c":"C"},
        3: {"d":"D"},
        4: {'c': {'b': 3}, 'a': [1,2,{'b':2}]}
    }

    merge(a,b)
    {
        1: {'a': 'A'},
        2: {'b': 'B', 'c': 'C'},
        3: {'d': 'D'},
        4: {'a': [1, 2, {'b': 2}], 'c': {'b': 3}}
    }
    """

    for key in b:
        if key in a:
            if isinstance(a[key], dict) and isinstance(b[key], dict):
                merge(a[key], b[key])
            else:
                a[key] = b[key]
        else:
            a[key] = b[key]
    return a


def tar(tar_path: Path | str, source_dir: Path | str) -> None:
    command = ['tar', 'cf', str(tar_path), '--sparse', str(source_dir)]
    execute(command)
