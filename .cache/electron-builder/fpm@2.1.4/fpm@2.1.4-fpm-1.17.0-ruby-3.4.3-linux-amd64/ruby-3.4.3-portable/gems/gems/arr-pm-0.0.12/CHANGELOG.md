

# v0.0.12

* Security: Fixed a safety problem which would allow for arbitrary shell execution when invoking `RPM::File#extract` or `RPM::File#files`. (Jordan Sissel, @joernchen; #14, #15)
* This library now has no external dependencies. (Jordan Sissel, #18)
* `RPM::File#extract` now correctly works when the target directory contains spaces or other special characters. (@joernchen, #19)
* Listing files (`RPM::File#files`) no longer requires external tools like `cpio` (Jordan Sissel, #17)


# v0.0.11

* Support Ruby 3.0 (Alexey Morozov, #12)
* Fix bug caused when listing config_files on an rpm with no config files. (Daniel Jay Haskin, #7)

# Older versions

Changelog not tracked for older versions.