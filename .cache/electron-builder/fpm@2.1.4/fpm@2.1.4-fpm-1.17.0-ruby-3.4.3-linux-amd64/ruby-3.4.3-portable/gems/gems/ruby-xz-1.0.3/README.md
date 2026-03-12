# ruby-xz

**ruby-xz** is a basic binding to the famous [liblzma] library,
best known for the extreme compression-ratio it's native *XZ* format achieves.
ruby-xz gives you the possibility of creating and extracting XZ archives on any
platform where liblzma is installed.
No compilation is needed, because ruby-xz is written on top of Ruby's [fiddle]
library (part of the standard library).
ruby-xz does not have any dependencies other than Ruby itself.

rubv-xz supports compression and decompression via methods that operate on
strings and files, and it also supports compression and decompression on IO
streams.
the XZ::StreamReader and XZ::StreamWriter offer advanced interfaces that allow
you to treat XZ-compressed data as IO streams, both for reading and for writing.
<!-- TODO: link to relevant parts of the source code and/or documentation  -->

**Note**: Version 1.0.0 breaks the API quite heavily.
Refer to HISTORY.rdoc for details.

## Installation

Install with `gem` from your Ruby installation:

```sh
gem install ruby-xz
```

Alternatively, add it to your Gemfile via:

```sh
bundle add ruby-xz
```

If you want to be on the bleeding edge, you can clone the repository and build
the most recent code yourself:

```sh
git clone https://github.com/win93/ruby-xz.git
cd ruby-xz
rake gem
gem install pkg/ruby-xz-*.gem
```

## Usage

You should be able to find everything you need to use ruby-xz in the
documentation.
It's small but powerful: You can create and extract whole archive files,
compress or decompress whole files, strings, or streams of data.

You can read the documentation on your local gemserver, or browse it [online][rubydoc].
 <!-- TODO how do I read the docs on my local gemserver? -->

### Examples

``` ruby
require 'xz'

# Compress a file
XZ.compress_file("myfile.txt", "myfile.txt.xz")
# Decompress it
XZ.decompress_file("myfile.txt.xz", "myfile.txt")

# Compress everything you get from a socket (note that there HAS to be a EOF
# sometime, otherwise this will run infinitely)
XZ.compress_stream(socket){|chunk| opened_file.write(chunk)}

# Compress a string
comp = XZ.compress("Mydata")
# Decompress it
data = XZ.decompress(comp)
```

Have a look at the XZ module's documentation for an in-depth description of what
is possible.
<!-- TODO link to such documentation -->

### Usage with the minitar gem

ruby-xz can be used together with the [minitar] library (formerly
“archive-tar-minitar”) to create XZ-compressed tarballs.
This works by employing the IO-like classes XZ::StreamReader and
XZ::StreamWriter analogous to how one would use Ruby's “zlib” library together
with “minitar”:

``` ruby
require "xz"
require "minitar"

# Create an XZ-compressed tarball
XZ::StreamWriter.open("tarball.tar.xz") do |txz|
  Minitar.pack("path/to/directory", txz)
end

# Unpack it again
XZ::StreamReader.open("tarball.tar.xz") do |txz|
  Minitar.unpack(txz, "path/to/target/directory")
end
```

## Development

After checking out the repo, run `bundle install` to install dependencies.

To install this gem onto your local machine, run `rake install`.

To release a new version:

- Switch to the `development` branch.
- Bump `lib/xz/version.rb`, run `bundle install`, then commit the result.
- Switch to the `stable` branch.
- Run `git merge development`
- Run `rake release`, which will create/push a git tag and publish the `.gem`
  file to [rubygems.org].

[rubygems.org]: https://rubygems.org

## Links

* Online documentation: <https://rubydoc.info/gems/ruby-xz>
* Code repository: <https://github.com/win93/ruby-xz>
* Issue tracker: <https://github.com/win93/ruby-xz/issues>

## License

MIT license; see LICENSE for the full license text.

## Acknowledgements

On November 2021, I volunteered to take over maintenance of this project, which
was forked from <https://github.com/Quintus/ruby-xz>.
@Quintus maintained this project until 1.0.0, see HISTORY.rdoc for more details.


[fiddle]: https://github.com/ruby/fiddle
[liblzma]: https://tukaani.org/xz/
[rubydoc]: https://www.rubydoc.info/gems/ruby-xz
[minitar]: https://github.com/halostatue/minitar
