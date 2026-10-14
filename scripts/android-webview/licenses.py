#!/usr/bin/env python3
"""Read-only proof of the reviewed packages' existing SDK license acceptance."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

POLICY = Path(__file__).with_name('sdk-license-policy.json')
MAX_XML = 8 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def license_value(text):
    # Android repository 31.13.0 TrimStringAdapter, Java ASCII regex and trim.
    text = re.sub(r'(?<=\s)[ \t]*', '', text, flags=re.ASCII)
    text = re.sub(r'(?<!\n)\n(?!\n)', ' ', text)
    return re.sub(' +', ' ', text).strip(''.join(map(chr, range(33))))


def acceptance_records(text):
    # Java/Guava readLines recognizes only CR, LF and CRLF, not Unicode separators.
    return re.split(r'\r\n|\r|\n', text)


def revision(node):
    require(node is not None, 'missing revision')
    require(all(c.tag in ('major', 'minor', 'micro') for c in node), 'unknown revision')
    require(len({c.tag for c in node}) == len(node), 'duplicate revision field')
    values = tuple(int(node.findtext(k, '0')) for k in ('major', 'minor', 'micro'))
    require(values[0] > 0 and min(values) >= 0, 'invalid revision')
    return list(values)


def dependencies(node):
    parents = node.findall('dependencies')
    require(len(parents) <= 1, 'duplicate dependencies')
    result = {}
    for dep in ([] if not parents else parents[0]):
        require(dep.tag == 'dependency' and set(dep.attrib) == {'path'}, 'unknown dependency')
        path = dep.get('path')
        require(path not in result and len(dep) == 1 and dep[0].tag == 'min-revision', 'unknown dependency revision')
        result[path] = revision(dep[0])
    return result


def parse(data, root_tag):
    require(len(data) <= MAX_XML and b'<!DOCTYPE' not in data and b'<!ENTITY' not in data, 'unsafe or oversized metadata')
    root = ET.fromstring(data)
    require(root.tag == root_tag, 'unknown metadata schema')
    return root


def check_license(root, node, policy, read_acceptance):
    refs = node.findall('uses-license')
    require(len(refs) == 1 and set(refs[0].attrib) == {'ref'}, 'unknown license reference')
    name = refs[0].get('ref')
    require(name in policy['licenses'], 'unreviewed license')
    matches = [n for n in root.findall('license') if n.get('id') == name]
    require(len(matches) == 1 and len(matches[0]) == 0 and matches[0].get('type', 'text') == 'text', 'unknown license definition')
    raw = matches[0].text or ''
    require(digest(raw.encode('utf-8')) == policy['licenses'][name], 'changed license text')
    marker = hashlib.sha1(license_value(raw).encode('utf-8')).hexdigest()
    # Read only. Never create a license directory or write an acceptance marker.
    require(marker in acceptance_records(read_acceptance(name)), 'required license acceptance not established: ' + name)
    return name


def verify_remote(policy, documents, read_acceptance):
    require(set(documents) == set(policy['sources']), 'missing repository metadata')
    selected = {}
    for source, spec in policy['sources'].items():
        root = parse(documents[source], spec['root'])
        for path, expected in policy['packages'].items():
            if expected['source'] != source:
                continue
            candidates = [n for n in root.findall('remotePackage') if n.get('path') == path and n.find('channelRef') is not None and n.find('channelRef').get('ref') == 'channel-0']
            require(len(candidates) == 1, 'missing or ambiguous stable package: ' + path)
            node = candidates[0]
            # Pin the complete selected metadata, including archive and dependency fields.
            require(digest(ET.tostring(node)) == expected['metadata_sha256'], 'changed or unknown package metadata: ' + path)
            require(revision(node.find('revision')) == expected['revision'], 'changed revision')
            require(dependencies(node) == expected['dependencies'], 'changed dependencies')
            name = check_license(root, node, policy, read_acceptance)
            selected[path] = {'revision': expected['revision'], 'license': name}
    require(set(selected) == set(policy['packages']), 'incomplete package set')
    for expected in policy['packages'].values():
        for path, minimum in expected['dependencies'].items():
            require(path in selected and selected[path]['revision'] >= minimum, 'unreviewed or unsatisfied dependency: ' + path)
    return selected


def verify_installed(policy, sdk, read_acceptance):
    for path, expected in policy['packages'].items():
        root = parse((sdk.joinpath(*path.split(';')) / 'package.xml').read_bytes(),
                     '{http://schemas.android.com/repository/android/common/02}repository')
        nodes = root.findall('localPackage')
        require(len(nodes) == 1 and nodes[0].get('path') == path, 'unknown installed package: ' + path)
        require(revision(nodes[0].find('revision')) == expected['revision'], 'installed revision differs: ' + path)
        require(dependencies(nodes[0]) == expected['dependencies'], 'installed dependencies differ: ' + path)
        # Local XML may reflow the license through JAXB. Compare the exact SDK value.
        refs = nodes[0].findall('uses-license')
        require(len(refs) == 1 and refs[0].get('ref') in policy['license_values'], 'unknown installed license')
        name = refs[0].get('ref')
        licenses = [n for n in root.findall('license') if n.get('id') == name]
        require(len(licenses) == 1 and not len(licenses[0]), 'unknown installed license definition')
        value = license_value(licenses[0].text or '')
        require(digest(value.encode()) == policy['license_values'][name], 'changed installed license text')
        require(hashlib.sha1(value.encode()).hexdigest() in acceptance_records(read_acceptance(name)), 'installed license acceptance not established')


def fetch(url):
    result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--proto', '=https',
                             '--max-time', '20', '--max-filesize', str(MAX_XML), url],
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=25, check=True)
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sdk', required=True, type=Path)
    parser.add_argument('--installed', action='store_true')
    parser.add_argument('packages', nargs='+')
    args = parser.parse_args()
    policy = json.loads(POLICY.read_text())
    require(len(args.packages) == len(set(args.packages)) and set(args.packages) == set(policy['packages']), 'requested package set differs from reviewed policy')
    read_acceptance = lambda name: (args.sdk / 'licenses' / name).read_text(encoding='utf-8')
    if args.installed:
        verify_installed(policy, args.sdk, read_acceptance)
        print('Installed package revisions, dependency closure and exact license acceptance verified')
    else:
        documents = {name: fetch(spec['url']) for name, spec in policy['sources'].items()}
        selected = verify_remote(policy, documents, read_acceptance)
        print(json.dumps({'packages': selected, 'metadata_sha256': {k: digest(v) for k, v in documents.items()},
                          'result': 'required existing acceptance verified; unrelated licenses not requested'}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, ET.ParseError, subprocess.SubprocessError) as error:
        print('BLOCKED: SDK license/package proof failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
