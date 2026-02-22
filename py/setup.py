from setuptools import setup

with open('README.md', 'r', encoding='utf-8') as fh:
    long_description = fh.read()

setup(
    name='jsee',
    version='0.6.0',
    packages=['jsee'],
    package_data={'jsee': ['static/*']},
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
