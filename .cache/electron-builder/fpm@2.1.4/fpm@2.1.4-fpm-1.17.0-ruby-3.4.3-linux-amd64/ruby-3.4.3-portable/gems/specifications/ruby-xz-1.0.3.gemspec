# -*- encoding: utf-8 -*-
# stub: ruby-xz 1.0.3 ruby lib

Gem::Specification.new do |s|
  s.name = "ruby-xz".freeze
  s.version = "1.0.3".freeze

  s.required_rubygems_version = Gem::Requirement.new(">= 0".freeze) if s.respond_to? :required_rubygems_version=
  s.metadata = { "bug_tracker_uri" => "https://github.com/win93/ruby-xz/issues", "changelog_uri" => "https://github.com/win93/ruby-xz/blob/stable/HISTORY.rdoc", "documentation_uri" => "https://www.rubydoc.info/gems/ruby-xz", "homepage_uri" => "https://github.com/win93/ruby-xz", "rubygems_mfa_required" => "true", "source_code_uri" => "https://github.com/win93/ruby-xz/tree/stable" } if s.respond_to? :metadata=
  s.require_paths = ["lib".freeze]
  s.authors = ["Marvin G\u00FClker".freeze, "Alex Gittemeier".freeze]
  s.date = "2022-03-28"
  s.description = "These are simple Ruby bindings for the liblzma library\n(http://tukaani.org/xz/), which is best known for the\nextreme compression ratio its native XZ format achieves.\nSince fiddle is used to implement the bindings, no compilation\nis needed.\n".freeze
  s.email = "me@a.lexg.dev".freeze
  s.extra_rdoc_files = ["README.md".freeze, "HISTORY.rdoc".freeze, "LICENSE".freeze, "AUTHORS".freeze]
  s.files = ["AUTHORS".freeze, "HISTORY.rdoc".freeze, "LICENSE".freeze, "README.md".freeze]
  s.homepage = "https://github.com/win93/ruby-xz".freeze
  s.licenses = ["MIT".freeze]
  s.post_install_message = "Version 1.0.0 of ruby-xz breaks the API. Read HISTORY.rdoc and adapt your code to the new API.".freeze
  s.rdoc_options = ["-t".freeze, "ruby-xz RDocs".freeze, "-m".freeze, "README.md".freeze]
  s.required_ruby_version = Gem::Requirement.new(">= 2.3.0".freeze)
  s.rubygems_version = "3.3.7".freeze
  s.summary = "XZ compression via liblzma for Ruby, using fiddle.".freeze

  s.installed_by_version = "3.6.7".freeze

  s.specification_version = 4

  s.add_development_dependency(%q<minitar>.freeze, ["~> 0.6".freeze])
  s.add_development_dependency(%q<minitest>.freeze, ["~> 5.14".freeze])
  s.add_development_dependency(%q<rake>.freeze, ["~> 13.0".freeze])
end
