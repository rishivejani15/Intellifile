import errno


def classify_access_error(err):
    if isinstance(err, PermissionError):
        return "permission_denied"
    if isinstance(err, FileNotFoundError):
        return "not_found"

    winerror = getattr(err, "winerror", None)
    if winerror == 5:
        return "permission_denied"
    if winerror == 32:
        return "file_locked"

    err_no = getattr(err, "errno", None)
    if err_no in (errno.EACCES, errno.EPERM):
        return "permission_denied"

    return None


def check_read_access(path):
    try:
        with open(path, "rb") as handle:
            handle.read(1)
        return True, None
    except OSError as exc:
        reason = classify_access_error(exc)
        return False, reason or "access_error"
