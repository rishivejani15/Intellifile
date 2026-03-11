import difflib

def generate_diff(old_content: str, new_content: str) -> str:
    """
    Generates unified diff between old and new content.
    Returns diff as string.
    """

    old_lines = old_content.splitlines()
    new_lines = new_content.splitlines()

    diff = difflib.unified_diff(
        old_lines,
        new_lines,
        fromfile="old_version",
        tofile="new_version",
        lineterm=""
    )

    return "\n".join(diff)
