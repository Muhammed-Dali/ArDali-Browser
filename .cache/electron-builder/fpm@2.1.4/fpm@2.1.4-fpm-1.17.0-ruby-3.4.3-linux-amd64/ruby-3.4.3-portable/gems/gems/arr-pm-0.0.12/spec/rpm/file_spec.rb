# encoding: utf-8

require "arr-pm/file"
require "stud/temporary"
require "insist"

describe ::RPM::File do
  subject { described_class.new(path) }

  context "with a known good rpm" do
    let(:path) { File.join(File.dirname(__FILE__), "../fixtures/pagure-mirror-5.13.2-5.fc35.noarch.rpm") }

    context "#files" do
      let(:files) { [
        "/usr/lib/systemd/system/pagure_mirror.service",
        "/usr/share/licenses/pagure-mirror",
        "/usr/share/licenses/pagure-mirror/LICENSE"
      ]}

      it "should have the correct list of files" do
        expect(subject.files).to eq(files)
      end
    end
  end

  context "#extract" do
    # This RPM should be correctly built, but we will modify the tags at runtime to force an error.
    let(:path) { File.join(File.dirname(__FILE__), "../fixtures/example-1.0-1.x86_64.rpm") }
    let(:dir) { dir = Stud::Temporary.directory }

    after do
      FileUtils.rm_rf(dir)
    end

    context "with an invalid payloadcompressor" do
      before do
        subject.tags[:payloadcompressor] = "some invalid | string"
      end

      it "should raise an error" do
        insist { subject.extract(dir) }.raises(RuntimeError)
      end
    end

    [ "gzip", "bzip2", "xz", "lzma", "zstd" ].each do |name|
      context "with a '#{name}' payloadcompressor" do
        before do
          subject.tags[:payloadcompressor] = name
        end

        it "should succeed" do
          reject { subject.extract(dir) }.raises(RuntimeError)
        end
      end
    end
  end
end
