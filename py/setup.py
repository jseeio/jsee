from pathlib import Path
from setuptools import setup
from setuptools.command.build_py import build_py
from setuptools.command.sdist import sdist


def require_runtime_assets():
    static = Path(__file__).parent / 'jsee' / 'static'
    missing = [name for name in ('jsee.core.js', 'jsee.full.js', 'schema.json')
               if not (static / name).is_file() or not (static / name).stat().st_size]
    if missing:
        raise RuntimeError('Missing browser runtime assets: {}. Run npm run build '
                           'from the repository root before building Python packages.'
                           .format(', '.join(missing)))


class BuildWithRuntime(build_py):
    def run(self):
        require_runtime_assets()
        super().run()


class SdistWithRuntime(sdist):
    def run(self):
        require_runtime_assets()
        super().run()

with open('README.md', 'r', encoding='utf-8') as fh:
    long_description = fh.read()

setup(
    name='jsee',
    version='0.9.0',
    packages=['jsee'],
    package_data={'jsee': ['static/*']},
    cmdclass={'build_py': BuildWithRuntime, 'sdist': SdistWithRuntime},
    scripts=['bin/jsee'],
    license='MIT',
    description='Turn Python functions into web apps with auto-generated GUI and REST API',
    long_description=long_description,
    long_description_content_type='text/markdown',
    author='Anton Zemlyansky',
    author_email='anton@zemlyansky.com',
    url='https://github.com/jseeio/jsee/tree/main/py',
    python_requires='>=3.9',
    classifiers=[
        'Programming Language :: Python :: 3',
        'License :: OSI Approved :: MIT License',
        'Operating System :: OS Independent',
    ],
)
