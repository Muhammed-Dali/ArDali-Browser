# encoding: utf-8

require "flores/random"

require "arr-pm/v2/lead"
require "arr-pm/v2/type"
require "arr-pm/v2/architecture"

describe ArrPM::V2::Lead do
  let(:major) { Flores::Random.integer(0..255) }
  let(:minor) { Flores::Random.integer(0..255) }
  let(:magic) { described_class::MAGIC }
  let(:type) { ArrPM::V2::Type::BINARY }
  let(:architecture) { ArrPM::V2::Architecture::I386 }
  let(:os) { 0 }
  let(:os_bytes) { [os].pack("n").unpack("C2") }
  let(:signature_type) { 0 }
  let(:signature_type_bytes) { [signature_type].pack("n").unpack("C2") }
  let(:longname) { "test-1.0-1" }
  let(:longnamebytes) { longname.bytes + (66-longname.bytesize).times.collect { 0 } }
  let(:leadbytes) { magic + [major, minor] + [0, type, 0, architecture] + longnamebytes + os_bytes + signature_type_bytes + 16.times.collect { 0 } }
  let(:lead) { leadbytes.pack("C*") }

  describe ".parse_magic" do
    context "when given an invalid magic value" do
      # Generate random bytes for the magic value, should be bad.
      let(:magic) { Flores::Random.iterations(0..10).collect { Flores::Random.integer(0..255) } }

      it "should fail" do
        expect { described_class.parse_magic(leadbytes) }.to raise_error(ArrPM::V2::Error::InvalidMagicValue)
      end
    end

    context "when given a valid magic value" do
      it "should succeed" do
        expect { described_class.parse_magic(leadbytes) }.not_to raise_error
      end
    end
  end

  describe ".parse_version" do
    context "when given an invalid version value" do
      let(:data) { magic + [major, minor] }

      it "should return an array of two values " do
        expect(described_class.parse_version(leadbytes)).to be == [major, minor]
      end
    end
  end

  describe ".parse_type" do
    context "when given an invalid type"  do
      let(:type) { Flores::Random.integer(2..1000) }
      it "should fail" do
        expect { described_class.parse_type(leadbytes) }.to raise_error(ArrPM::V2::Error::InvalidType)
      end
    end
    context "with a valid type"  do
      it "should return the type" do
        expect(described_class.parse_type(leadbytes)).to be == type
      end
    end
  end

  describe ".parse_name" do
    context "with a valid name" do
      it "should return the name" do
        expect(described_class.parse_name(leadbytes)).to be == longname
      end
    end
  end

  describe ".parse_signature_type" do
    it "should return the signature type" do
      expect(described_class.parse_signature_type(leadbytes)).to be == signature_type
    end
  end

  describe ".parse_reserved" do
    it "should return exactly 16 bytes" do
      expect(described_class.parse_reserved(leadbytes).count).to be == 16
    end
  end

  describe "#parse" do
    before do
      subject.parse(lead)
    end

    it "should have a correct parsed values" do
      expect(subject.name).to be == longname
      expect(subject.major).to be == major
      expect(subject.minor).to be == minor
      expect(subject.type).to be == type
      expect(subject.architecture).to be == architecture
    end
  end

  describe "#dump" do
    before do
      subject.parse(lead)
    end

    let(:blob) { subject.serialize }

    it "should parse successfully" do
      subject.parse(blob)
    end
  end

  context "with a known good rpm" do
    let(:path) { File.join(File.dirname(__FILE__), "../../fixtures/example-1.0-1.x86_64.rpm") }

    before do
      subject.load(File.new(path))
    end

    it "should have expected values" do
      expect(subject.name).to be == "example-1.0-1"
      expect(subject.major).to be == 3
      expect(subject.minor).to be == 0
      expect(subject.architecture).to be == architecture
    end
  end
end
